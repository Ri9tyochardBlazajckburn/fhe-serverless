// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract FheServerlessFramework is SepoliaConfig {

    struct EncryptedFunction {
        uint256 id;
        euint32 encryptedInput;
        euint32 encryptedParameters;
        uint256 timestamp;
    }

    struct DecryptedFunction {
        uint32 input;
        uint32 parameters;
        bool executed;
    }

    uint256 public functionCount;
    mapping(uint256 => EncryptedFunction) public encryptedFunctions;
    mapping(uint256 => DecryptedFunction) public decryptedFunctions;

    mapping(string => euint32) private encryptedExecutionStats;
    string[] private functionList;

    mapping(uint256 => uint256) private requestToFunctionId;

    event FunctionSubmitted(uint256 indexed id, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event FunctionExecuted(uint256 indexed id);

    modifier onlyOwner(uint256 functionId) {
        _;
    }

    function submitEncryptedFunction(euint32 encryptedInput, euint32 encryptedParameters) public {
        functionCount += 1;
        uint256 newId = functionCount;

        encryptedFunctions[newId] = EncryptedFunction({
            id: newId,
            encryptedInput: encryptedInput,
            encryptedParameters: encryptedParameters,
            timestamp: block.timestamp
        });

        decryptedFunctions[newId] = DecryptedFunction({
            input: 0,
            parameters: 0,
            executed: false
        });

        emit FunctionSubmitted(newId, block.timestamp);
    }

    function requestFunctionDecryption(uint256 functionId) public onlyOwner(functionId) {
        EncryptedFunction storage fn = encryptedFunctions[functionId];
        require(!decryptedFunctions[functionId].executed, "Already executed");

        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(fn.encryptedInput);
        ciphertexts[1] = FHE.toBytes32(fn.encryptedParameters);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptFunction.selector);
        requestToFunctionId[reqId] = functionId;

        emit DecryptionRequested(functionId);
    }

    function decryptFunction(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        uint256 functionId = requestToFunctionId[requestId];
        require(functionId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        DecryptedFunction storage df = decryptedFunctions[functionId];

        df.input = results[0];
        df.parameters = results[1];
        df.executed = true;

        if (!FHE.isInitialized(encryptedExecutionStats[functionList[functionId % functionList.length]])) {
            encryptedExecutionStats[functionList[functionId % functionList.length]] = FHE.asEuint32(0);
            functionList.push(string(abi.encodePacked("fn_", uint2str(functionId))));
        }

        encryptedExecutionStats[functionList[functionId % functionList.length]] = FHE.add(
            encryptedExecutionStats[functionList[functionId % functionList.length]],
            FHE.asEuint32(1)
        );

        emit FunctionExecuted(functionId);
    }

    function getDecryptedFunction(uint256 functionId) public view returns (uint32 input, uint32 parameters, bool executed) {
        DecryptedFunction storage df = decryptedFunctions[functionId];
        return (df.input, df.parameters, df.executed);
    }

    function getEncryptedExecutionStats(string memory fnName) public view returns (euint32) {
        return encryptedExecutionStats[fnName];
    }

    function requestExecutionStatsDecryption(string memory fnName) public {
        euint32 count = encryptedExecutionStats[fnName];
        require(FHE.isInitialized(count), "Function not found");

        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(count);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptExecutionStats.selector);
        requestToFunctionId[reqId] = uint256(keccak256(abi.encodePacked(fnName)));
    }

    function decryptExecutionStats(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        uint256 fnHash = requestToFunctionId[requestId];

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32 count = abi.decode(cleartexts, (uint32));
    }

    function uint2str(uint256 _i) internal pure returns (string memory str) {
        if (_i == 0) return "0";
        uint256 j = _i;
        uint256 length;
        while (j != 0) {
            length++;
            j /= 10;
        }
        bytes memory bstr = new bytes(length);
        uint256 k = length;
        j = _i;
        while (j != 0) {
            bstr[--k] = bytes1(uint8(48 + j % 10));
            j /= 10;
        }
        str = string(bstr);
    }
}
