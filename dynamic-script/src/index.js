const Web3 = require("web3");
const RealitioForeignArbitrationProxy = require("@kleros/cross-chain-realitio-contracts/artifacts-zk/src/zkRealitioForeignProxy.sol/zkRealitioForeignProxy.json");
const RealitioHomeArbitrationProxy = require("@kleros/cross-chain-realitio-contracts/artifacts-zk/src/zkRealitioHomeProxy.sol/zkRealitioHomeProxy.json");
const RealitioInterface = require("@kleros/cross-chain-realitio-contracts/artifacts-zk/src/RealitioInterface.sol/RealitioInterface.json");
const RealitioQuestion = require("@realitio/realitio-lib/formatters/question.js");

// TODO: replace the hardcoded value
const fromBlock = 9757046;

const isNil = (value) => value === undefined || value === null;

module.exports = async function getMetaEvidence() {
  const { disputeID, arbitrableContractAddress, arbitrableJsonRpcUrl, arbitratorJsonRpcUrl, jsonRpcUrl } =
    scriptParameters;
  if (isNil(disputeID) || isNil(arbitrableContractAddress)) {
    return rejectScript("Both `disputeID` and `arbitrableContractAddress` script parameters are required");
  }

  const foreignWeb3 = new Web3(arbitratorJsonRpcUrl || jsonRpcUrl);
  const foreignProxy = new foreignWeb3.eth.Contract(RealitioForeignArbitrationProxy.abi, arbitrableContractAddress);

  const homeWeb3 = new Web3(arbitrableJsonRpcUrl || jsonRpcUrl);
  const homeProxy = new homeWeb3.eth.Contract(
    RealitioHomeArbitrationProxy.abi,
    await foreignProxy.methods.homeProxy().call()
  );
  const realitio = new homeWeb3.eth.Contract(RealitioInterface.abi, await homeProxy.methods.realitio().call());

  const arbitrationCreatedLogs = await foreignProxy.getPastEvents("ArbitrationCreated", {
    filter: {
      _disputeID: disputeID,
    },
    fromBlock: fromBlock,
    toBlock: "latest",
  });

  if (arbitrationCreatedLogs.length != 1) {
    return rejectScript("Could not find the dispute");
  }

  const questionID = arbitrationCreatedLogs[0].returnValues._questionID;

  const questionEventLog = await realitio.getPastEvents("LogNewQuestion", {
    filter: {
      question_id: questionID,
    },
    fromBlock: fromBlock,
    toBlock: "latest",
  });
  const templateID = questionEventLog[0].returnValues.template_id;

  const templateEventLog = await realitio.getPastEvents("LogNewTemplate", {
    filter: {
      template_id: templateID,
    },
    fromBlock: fromBlock,
    toBlock: "latest",
  });
  const templateText = templateEventLog[0].returnValues.question_text;
  const questionData = RealitioQuestion.populatedJSONForTemplate(
    templateText,
    questionEventLog[0].returnValues.question
  );

  const erc1497OverridesMixin = questionData.title ? { question: questionData.title } : {};

  switch (questionData.type) {
    case "bool":
      return resolveScript({
        ...erc1497OverridesMixin,
        rulingOptions: {
          type: "single-select",
          titles: ["No", "Yes"],
          reserved: {
            "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF": "Answered Too Soon",
          },
        },
      });
    case "uint":
      return resolveScript({
        ...erc1497OverridesMixin,
        rulingOptions: {
          type: "uint",
          precision: questionData.decimals,
          reserved: {
            "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF": "Answered Too Soon",
          },
        },
      });
    case "single-select":
      return resolveScript({
        ...erc1497OverridesMixin,
        rulingOptions: {
          type: "single-select",
          titles: questionData.outcomes,
          reserved: {
            "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF": "Answered Too Soon",
          },
        },
      });
    case "multiple-select":
      return resolveScript({
        ...erc1497OverridesMixin,
        rulingOptions: {
          type: "multiple-select",
          titles: questionData.outcomes,
          reserved: {
            "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF": "Answered Too Soon",
          },
        },
      });
    case "datetime":
      return resolveScript({
        ...erc1497OverridesMixin,
        rulingOptions: {
          type: "datetime",
          reserved: {
            "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF": "Answered Too Soon",
          },
        },
      });
    default:
      return resolveScript({ ...erc1497OverridesMixin });
  }
};
