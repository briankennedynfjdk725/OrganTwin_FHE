// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract OrganDigitalTwinFHE is SepoliaConfig {
    struct EncryptedOrganModel {
        uint256 twinId;
        euint32 encryptedOrganType;       // Encrypted organ identifier
        euint32 encryptedPhysioData;      // Encrypted physiological data
        euint32 encryptedGeneticMarkers;   // Encrypted genetic markers
        uint256 creationTime;
    }

    struct EncryptedSimulationParams {
        euint32 encryptedDrugCompound;    // Encrypted drug identifier
        euint32 encryptedDosage;          // Encrypted dosage amount
        euint32 encryptedProcedureType;   // Encrypted surgical procedure code
    }

    struct DecryptedSimulationResult {
        string predictedEffect;
        string riskAssessment;
        string recommendedAdjustment;
        bool isRevealed;
    }

    uint256 public twinCount;
    mapping(uint256 => EncryptedOrganModel) public encryptedOrganTwins;
    mapping(uint256 => EncryptedSimulationParams) public encryptedSimulations;
    mapping(uint256 => DecryptedSimulationResult) public decryptedResults;
    
    mapping(string => euint32) private encryptedOrganTypeCount;
    string[] private organTypeList;
    
    mapping(uint256 => uint256) private requestToTwinId;

    event TwinCreated(uint256 indexed id, uint256 timestamp);
    event SimulationRequested(uint256 indexed twinId);
    event SimulationCompleted(uint256 indexed twinId, string riskLevel);

    modifier onlyAuthorizedDoctor(uint256 twinId) {
        // Access control for medical professionals would be implemented here
        _;
    }

    function createEncryptedTwin(
        euint32 encryptedOrganType,
        euint32 encryptedPhysioData,
        euint32 encryptedGeneticMarkers
    ) public {
        twinCount += 1;
        uint256 newId = twinCount;
        
        encryptedOrganTwins[newId] = EncryptedOrganModel({
            twinId: newId,
            encryptedOrganType: encryptedOrganType,
            encryptedPhysioData: encryptedPhysioData,
            encryptedGeneticMarkers: encryptedGeneticMarkers,
            creationTime: block.timestamp
        });

        decryptedResults[newId] = DecryptedSimulationResult({
            predictedEffect: "",
            riskAssessment: "",
            recommendedAdjustment: "",
            isRevealed: false
        });

        emit TwinCreated(newId, block.timestamp);
    }

    function requestDrugSimulation(
        uint256 twinId,
        euint32 encryptedDrugCompound,
        euint32 encryptedDosage
    ) public onlyAuthorizedDoctor(twinId) {
        require(twinId <= twinCount, "Invalid twin ID");
        
        encryptedSimulations[twinId] = EncryptedSimulationParams({
            encryptedDrugCompound: encryptedDrugCompound,
            encryptedDosage: encryptedDosage,
            encryptedProcedureType: FHE.asEuint32(0)
        });

        bytes32[] memory ciphertexts = prepareSimulationData(twinId, false);
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.processSimulationResult.selector);
        requestToTwinId[reqId] = twinId;

        emit SimulationRequested(twinId);
    }

    function requestSurgerySimulation(
        uint256 twinId,
        euint32 encryptedProcedureType
    ) public onlyAuthorizedDoctor(twinId) {
        require(twinId <= twinCount, "Invalid twin ID");
        
        encryptedSimulations[twinId] = EncryptedSimulationParams({
            encryptedDrugCompound: FHE.asEuint32(0),
            encryptedDosage: FHE.asEuint32(0),
            encryptedProcedureType: encryptedProcedureType
        });

        bytes32[] memory ciphertexts = prepareSimulationData(twinId, true);
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.processSimulationResult.selector);
        requestToTwinId[reqId] = twinId;

        emit SimulationRequested(twinId);
    }

    function processSimulationResult(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 twinId = requestToTwinId[requestId];
        require(twinId != 0, "Invalid request");
        
        DecryptedSimulationResult storage result = decryptedResults[twinId];
        require(!result.isRevealed, "Already processed");

        FHE.checkSignatures(requestId, cleartexts, proof);

        string[] memory simulationData = abi.decode(cleartexts, (string[]));
        
        result.predictedEffect = generatePrediction(simulationData);
        result.riskAssessment = assessRisks(simulationData);
        result.recommendedAdjustment = suggestAdjustments(simulationData);
        result.isRevealed = true;

        updateOrganTypeStatistics(simulationData[0]);

        emit SimulationCompleted(twinId, result.riskAssessment);
    }

    function getSimulationResult(uint256 twinId) public view returns (
        string memory predictedEffect,
        string memory riskAssessment,
        string memory recommendedAdjustment,
        bool isRevealed
    ) {
        DecryptedSimulationResult storage r = decryptedResults[twinId];
        return (r.predictedEffect, r.riskAssessment, r.recommendedAdjustment, r.isRevealed);
    }

    function requestOrganTypeCountDecryption(string memory organType) public onlyAuthorizedDoctor(bytes32ToUint(keccak256(abi.encodePacked(organType)))) {
        euint32 count = encryptedOrganTypeCount[organType];
        require(FHE.isInitialized(count), "Organ type not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(count);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptOrganTypeCount.selector);
        requestToTwinId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(organType)));
    }

    function decryptOrganTypeCount(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 organTypeHash = requestToTwinId[requestId];
        string memory organType = getOrganTypeFromHash(organTypeHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 count = abi.decode(cleartexts, (uint32));
    }

    function prepareSimulationData(uint256 twinId, bool isSurgery) private view returns (bytes32[] memory) {
        EncryptedOrganModel storage model = encryptedOrganTwins[twinId];
        EncryptedSimulationParams storage params = encryptedSimulations[twinId];

        bytes32[] memory ciphertexts = new bytes32[](isSurgery ? 4 : 4);
        ciphertexts[0] = FHE.toBytes32(model.encryptedOrganType);
        ciphertexts[1] = FHE.toBytes32(model.encryptedPhysioData);
        ciphertexts[2] = FHE.toBytes32(model.encryptedGeneticMarkers);
        ciphertexts[3] = isSurgery 
            ? FHE.toBytes32(params.encryptedProcedureType)
            : FHE.toBytes32(params.encryptedDrugCompound);

        return ciphertexts;
    }

    function generatePrediction(string[] memory data) private pure returns (string memory) {
        return "Improved cardiac output by 15%";
    }

    function assessRisks(string[] memory data) private pure returns (string memory) {
        return "Low risk of arrhythmia";
    }

    function suggestAdjustments(string[] memory data) private pure returns (string memory) {
        return "Reduce dosage by 20% for renal patients";
    }

    function updateOrganTypeStatistics(string memory organType) private {
        if (FHE.isInitialized(encryptedOrganTypeCount[organType]) == false) {
            encryptedOrganTypeCount[organType] = FHE.asEuint32(0);
            organTypeList.push(organType);
        }
        encryptedOrganTypeCount[organType] = FHE.add(
            encryptedOrganTypeCount[organType], 
            FHE.asEuint32(1)
        );
    }

    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }

    function getOrganTypeFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < organTypeList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(organTypeList[i]))) == hash) {
                return organTypeList[i];
            }
        }
        revert("Organ type not found");
    }
}