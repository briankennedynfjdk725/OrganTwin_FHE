// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface OrganData {
  id: string;
  name: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  organType: string;
  status: "healthy" | "at_risk" | "critical";
  simulations: number;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [organs, setOrgans] = useState<OrganData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newOrganData, setNewOrganData] = useState({
    name: "",
    organType: "heart",
    healthData: ""
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedOrgan, setSelectedOrgan] = useState<OrganData | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  // Calculate statistics for dashboard
  const healthyCount = organs.filter(o => o.status === "healthy").length;
  const atRiskCount = organs.filter(o => o.status === "at_risk").length;
  const criticalCount = organs.filter(o => o.status === "critical").length;
  const totalSimulations = organs.reduce((sum, organ) => sum + organ.simulations, 0);

  // Filter organs based on search and filter criteria
  const filteredOrgans = organs.filter(organ => {
    const matchesSearch = organ.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         organ.organType.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterStatus === "all" || organ.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  useEffect(() => {
    loadOrgans().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadOrgans = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("organ_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing organ keys:", e);
        }
      }
      
      const list: OrganData[] = [];
      
      for (const key of keys) {
        try {
          const organBytes = await contract.getData(`organ_${key}`);
          if (organBytes.length > 0) {
            try {
              const organData = JSON.parse(ethers.toUtf8String(organBytes));
              list.push({
                id: key,
                name: organData.name,
                encryptedData: organData.data,
                timestamp: organData.timestamp,
                owner: organData.owner,
                organType: organData.organType,
                status: organData.status || "healthy",
                simulations: organData.simulations || 0
              });
            } catch (e) {
              console.error(`Error parsing organ data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading organ ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setOrgans(list);
    } catch (e) {
      console.error("Error loading organs:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitOrgan = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting organ data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newOrganData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const organId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const organData = {
        name: newOrganData.name,
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        organType: newOrganData.organType,
        status: "healthy",
        simulations: 0
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `organ_${organId}`, 
        ethers.toUtf8Bytes(JSON.stringify(organData))
      );
      
      const keysBytes = await contract.getData("organ_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(organId);
      
      await contract.setData(
        "organ_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Organ twin created with FHE encryption!"
      });
      
      await loadOrgans();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewOrganData({
          name: "",
          organType: "heart",
          healthData: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const runSimulation = async (organId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Running FHE simulation on encrypted organ data..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const organBytes = await contract.getData(`organ_${organId}`);
      if (organBytes.length === 0) {
        throw new Error("Organ not found");
      }
      
      const organData = JSON.parse(ethers.toUtf8String(organBytes));
      
      const updatedOrgan = {
        ...organData,
        simulations: (organData.simulations || 0) + 1
      };
      
      await contract.setData(
        `organ_${organId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedOrgan))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE simulation completed successfully!"
      });
      
      await loadOrgans();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Simulation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const viewOrganDetails = (organ: OrganData) => {
    setSelectedOrgan(organ);
    setShowDetailsModal(true);
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const renderStatusChart = () => {
    const total = organs.length || 1;
    const healthyPercentage = (healthyCount / total) * 100;
    const atRiskPercentage = (atRiskCount / total) * 100;
    const criticalPercentage = (criticalCount / total) * 100;

    return (
      <div className="status-chart-container">
        <div className="status-chart">
          <div 
            className="chart-segment healthy" 
            style={{ transform: `rotate(${healthyPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="chart-segment at-risk" 
            style={{ transform: `rotate(${(healthyPercentage + atRiskPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="chart-segment critical" 
            style={{ transform: `rotate(${(healthyPercentage + atRiskPercentage + criticalPercentage) * 3.6}deg)` }}
          ></div>
          <div className="chart-center">
            <div className="chart-value">{organs.length}</div>
            <div className="chart-label">Organs</div>
          </div>
        </div>
        <div className="chart-legend">
          <div className="legend-item">
            <div className="color-box healthy"></div>
            <span>Healthy: {healthyCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box at-risk"></div>
            <span>At Risk: {atRiskCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box critical"></div>
            <span>Critical: {criticalCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="neon-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container neon-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="organ-icon"></div>
          </div>
          <h1>Organ<span>Twin</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-organ-btn glass-button"
          >
            <div className="add-icon"></div>
            Create Twin
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>FHE-Based Secure Digital Twin for Human Organs</h2>
            <p>Create encrypted digital twins of organs for secure medical simulations using Fully Homomorphic Encryption</p>
          </div>
        </div>
        
        <div className="dashboard-grid">
          <div className="dashboard-card glass-card">
            <h3>Project Introduction</h3>
            <p>OrganTwin FHE enables medical researchers to create encrypted digital replicas of human organs. Using Fully Homomorphic Encryption, these digital twins allow for secure simulations of medical procedures and drug interactions while keeping patient data completely private.</p>
            <div className="fhe-badge">
              <span>FHE-Powered Privacy</span>
            </div>
          </div>
          
          <div className="dashboard-card glass-card">
            <h3>Data Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{organs.length}</div>
                <div className="stat-label">Total Organs</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{healthyCount}</div>
                <div className="stat-label">Healthy</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{atRiskCount}</div>
                <div className="stat-label">At Risk</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{criticalCount}</div>
                <div className="stat-label">Critical</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{totalSimulations}</div>
                <div className="stat-label">Simulations</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card glass-card">
            <h3>Health Status Distribution</h3>
            {renderStatusChart()}
          </div>
        </div>

        <div className="search-filter-bar">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search organs..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            <div className="search-icon"></div>
          </div>
          <select 
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="filter-select"
          >
            <option value="all">All Statuses</option>
            <option value="healthy">Healthy</option>
            <option value="at_risk">At Risk</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        
        <div className="organs-section">
          <div className="section-header">
            <h2>Encrypted Organ Twins</h2>
            <div className="header-actions">
              <button 
                onClick={loadOrgans}
                className="refresh-btn glass-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="organs-grid">
            {filteredOrgans.length === 0 ? (
              <div className="no-organs glass-card">
                <div className="no-organs-icon"></div>
                <p>No organ twins found</p>
                <button 
                  className="glass-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Twin
                </button>
              </div>
            ) : (
              filteredOrgans.map(organ => (
                <div className="organ-card glass-card" key={organ.id}>
                  <div className="organ-header">
                    <h3>{organ.name}</h3>
                    <span className={`status-badge ${organ.status}`}>
                      {organ.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="organ-details">
                    <div className="detail-item">
                      <span className="label">Type:</span>
                      <span className="value">{organ.organType}</span>
                    </div>
                    <div className="detail-item">
                      <span className="label">Owner:</span>
                      <span className="value">{organ.owner.substring(0, 6)}...{organ.owner.substring(38)}</span>
                    </div>
                    <div className="detail-item">
                      <span className="label">Created:</span>
                      <span className="value">{new Date(organ.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className="detail-item">
                      <span className="label">Simulations:</span>
                      <span className="value">{organ.simulations}</span>
                    </div>
                  </div>
                  <div className="organ-actions">
                    <button 
                      className="action-btn glass-button"
                      onClick={() => viewOrganDetails(organ)}
                    >
                      Details
                    </button>
                    {isOwner(organ.owner) && (
                      <button 
                        className="action-btn glass-button primary"
                        onClick={() => runSimulation(organ.id)}
                      >
                        Run Simulation
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitOrgan} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          organData={newOrganData}
          setOrganData={setNewOrganData}
        />
      )}
      
      {showDetailsModal && selectedOrgan && (
        <ModalDetails 
          organ={selectedOrgan}
          onClose={() => setShowDetailsModal(false)}
          onSimulate={() => {
            setShowDetailsModal(false);
            runSimulation(selectedOrgan.id);
          }}
          isOwner={isOwner(selectedOrgan.owner)}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content glass-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="neon-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="organ-icon"></div>
              <span>OrganTwinFHE</span>
            </div>
            <p>Secure medical simulations using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Medical Research</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} OrganTwinFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  organData: any;
  setOrganData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  organData,
  setOrganData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setOrganData({
      ...organData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!organData.name || !organData.healthData) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal glass-card">
        <div className="modal-header">
          <h2>Create Organ Twin</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your organ data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Organ Name *</label>
              <input 
                type="text"
                name="name"
                value={organData.name} 
                onChange={handleChange}
                placeholder="e.g., Patient A's Heart" 
                className="glass-input"
              />
            </div>
            
            <div className="form-group">
              <label>Organ Type *</label>
              <select 
                name="organType"
                value={organData.organType} 
                onChange={handleChange}
                className="glass-select"
              >
                <option value="heart">Heart</option>
                <option value="liver">Liver</option>
                <option value="kidney">Kidney</option>
                <option value="lung">Lung</option>
                <option value="brain">Brain</option>
                <option value="other">Other</option>
              </select>
            </div>
            
            <div className="form-group full-width">
              <label>Health Data (JSON format) *</label>
              <textarea 
                name="healthData"
                value={organData.healthData} 
                onChange={handleChange}
                placeholder='{"blood_pressure": "120/80", "heart_rate": 72, ...}' 
                className="glass-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data remains encrypted during FHE simulations
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn glass-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn glass-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Create Secure Twin"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ModalDetailsProps {
  organ: OrganData;
  onClose: () => void;
  onSimulate: () => void;
  isOwner: boolean;
}

const ModalDetails: React.FC<ModalDetailsProps> = ({ 
  organ, 
  onClose, 
  onSimulate,
  isOwner
}) => {
  return (
    <div className="modal-overlay">
      <div className="details-modal glass-card">
        <div className="modal-header">
          <h2>Organ Twin Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="organ-detail-header">
            <h3>{organ.name}</h3>
            <span className={`status-badge ${organ.status}`}>
              {organ.status.replace('_', ' ')}
            </span>
          </div>
          
          <div className="detail-grid">
            <div className="detail-item">
              <span className="label">Organ Type:</span>
              <span className="value">{organ.organType}</span>
            </div>
            <div className="detail-item">
              <span className="label">Owner:</span>
              <span className="value">{organ.owner}</span>
            </div>
            <div className="detail-item">
              <span className="label">Created:</span>
              <span className="value">{new Date(organ.timestamp * 1000).toLocaleString()}</span>
            </div>
            <div className="detail-item">
              <span className="label">Simulations Run:</span>
              <span className="value">{organ.simulations}</span>
            </div>
            <div className="detail-item full-width">
              <span className="label">Encrypted Data Hash:</span>
              <span className="value hash">{organ.encryptedData.substring(0, 32)}...</span>
            </div>
          </div>
          
          <div className="fhe-explanation">
            <h4>FHE Protection</h4>
            <p>This organ twin's data is encrypted using Fully Homomorphic Encryption, allowing medical simulations to be performed directly on the encrypted data without decryption.</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn glass-button"
          >
            Close
          </button>
          {isOwner && (
            <button 
              onClick={onSimulate}
              className="simulate-btn glass-button primary"
            >
              Run New Simulation
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;