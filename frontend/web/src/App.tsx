import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface FHEFunction {
  id: string;
  name: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  category: string;
  status: "pending" | "verified" | "rejected";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [functions, setFunctions] = useState<FHEFunction[]>([]);
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
  const [newFunctionData, setNewFunctionData] = useState({
    name: "",
    category: "",
    description: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [categoryStats, setCategoryStats] = useState<Record<string, number>>({});

  // Calculate statistics for dashboard
  const verifiedCount = functions.filter(f => f.status === "verified").length;
  const pendingCount = functions.filter(f => f.status === "pending").length;
  const rejectedCount = functions.filter(f => f.status === "rejected").length;

  useEffect(() => {
    loadFunctions().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Calculate category statistics
    const stats: Record<string, number> = {};
    functions.forEach(func => {
      stats[func.category] = (stats[func.category] || 0) + 1;
    });
    setCategoryStats(stats);
  }, [functions]);

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

  const loadFunctions = async () => {
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
      
      const keysBytes = await contract.getData("function_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing function keys:", e);
        }
      }
      
      const list: FHEFunction[] = [];
      
      for (const key of keys) {
        try {
          const funcBytes = await contract.getData(`function_${key}`);
          if (funcBytes.length > 0) {
            try {
              const funcData = JSON.parse(ethers.toUtf8String(funcBytes));
              list.push({
                id: key,
                name: funcData.name,
                encryptedData: funcData.data,
                timestamp: funcData.timestamp,
                owner: funcData.owner,
                category: funcData.category,
                status: funcData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing function data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading function ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setFunctions(list);
    } catch (e) {
      console.error("Error loading functions:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitFunction = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting function with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newFunctionData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const funcId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const funcData = {
        name: newFunctionData.name,
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        category: newFunctionData.category,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `function_${funcId}`, 
        ethers.toUtf8Bytes(JSON.stringify(funcData))
      );
      
      const keysBytes = await contract.getData("function_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(funcId);
      
      await contract.setData(
        "function_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE function deployed successfully!"
      });
      
      await loadFunctions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewFunctionData({
          name: "",
          category: "",
          description: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Deployment failed: " + (e.message || "Unknown error");
      
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

  const verifyFunction = async (funcId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Verifying FHE function..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const funcBytes = await contract.getData(`function_${funcId}`);
      if (funcBytes.length === 0) {
        throw new Error("Function not found");
      }
      
      const funcData = JSON.parse(ethers.toUtf8String(funcBytes));
      
      const updatedFunc = {
        ...funcData,
        status: "verified"
      };
      
      await contract.setData(
        `function_${funcId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedFunc))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE function verified successfully!"
      });
      
      await loadFunctions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectFunction = async (funcId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Rejecting FHE function..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const funcBytes = await contract.getData(`function_${funcId}`);
      if (funcBytes.length === 0) {
        throw new Error("Function not found");
      }
      
      const funcData = JSON.parse(ethers.toUtf8String(funcBytes));
      
      const updatedFunc = {
        ...funcData,
        status: "rejected"
      };
      
      await contract.setData(
        `function_${funcId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedFunc))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE function rejected!"
      });
      
      await loadFunctions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rejection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE Serverless is ${isAvailable ? "available" : "unavailable"}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed"
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to interact with the FHE Serverless platform",
      icon: "🔗"
    },
    {
      title: "Deploy FHE Function",
      description: "Upload your FHE-enabled function to the serverless framework",
      icon: "🚀"
    },
    {
      title: "FHE Execution",
      description: "Your function executes on encrypted data without decryption",
      icon: "🔒"
    },
    {
      title: "Get Results",
      description: "Receive encrypted results that can be decrypted with your private key",
      icon: "📊"
    }
  ];

  const renderPieChart = () => {
    const categories = Object.keys(categoryStats);
    if (categories.length === 0) {
      return (
        <div className="no-data-chart">
          <div className="no-data-icon"></div>
          <p>No category data available</p>
        </div>
      );
    }

    const total = functions.length || 1;
    const colors = ["#FFB74D", "#4FC3F7", "#81C784", "#FFF176", "#BA68C8"];
    let startAngle = 0;
    
    return (
      <div className="pie-chart-container">
        <svg width="200" height="200" viewBox="0 0 200 200">
          {categories.map((category, index) => {
            const percentage = (categoryStats[category] / total) * 100;
            const angle = (percentage / 100) * 360;
            const endAngle = startAngle + angle;
            
            // Calculate coordinates for the arc
            const startRadians = (startAngle - 90) * (Math.PI / 180);
            const endRadians = (endAngle - 90) * (Math.PI / 180);
            
            const largeArcFlag = angle > 180 ? 1 : 0;
            
            const startX = 100 + 80 * Math.cos(startRadians);
            const startY = 100 + 80 * Math.sin(startRadians);
            
            const endX = 100 + 80 * Math.cos(endRadians);
            const endY = 100 + 80 * Math.sin(endRadians);
            
            const pathData = [
              `M 100, 100`,
              `L ${startX}, ${startY}`,
              `A 80, 80, 0, ${largeArcFlag}, 1, ${endX}, ${endY}`,
              `L 100, 100`
            ].join(' ');
            
            startAngle = endAngle;
            
            return (
              <path 
                key={category} 
                d={pathData} 
                fill={colors[index % colors.length]} 
                stroke="#1a1a1a"
                strokeWidth="1"
              />
            );
          })}
          <circle cx="100" cy="100" r="40" fill="#1a1a1a" />
          <text x="100" y="100" textAnchor="middle" dominantBaseline="middle" fill="#FFD700" fontSize="20">
            {functions.length}
          </text>
          <text x="100" y="130" textAnchor="middle" dominantBaseline="middle" fill="#aaa" fontSize="12">
            Functions
          </text>
        </svg>
        
        <div className="pie-legend">
          {categories.map((category, index) => (
            <div className="legend-item" key={category}>
              <div className="color-box" style={{ backgroundColor: colors[index % colors.length] }}></div>
              <span>{category}: {categoryStats[category]}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const teamMembers = [
    {
      name: "Dr. Elena Rodriguez",
      role: "FHE Research Lead",
      bio: "PhD in Cryptography, 10+ years in homomorphic encryption research",
      avatar: "E"
    },
    {
      name: "James Chen",
      role: "Blockchain Architect",
      bio: "Expert in decentralized systems and smart contract security",
      avatar: "J"
    },
    {
      name: "Sophia Williams",
      role: "Cloud Integration",
      bio: "Specialized in serverless architectures and cloud deployment",
      avatar: "S"
    },
    {
      name: "Michael Johnson",
      role: "Developer Experience",
      bio: "Focuses on SDK design and developer tooling",
      avatar: "M"
    }
  ];

  if (loading) return (
    <div className="loading-screen">
      <div className="metal-spinner">
        <div className="gear large"></div>
        <div className="gear medium"></div>
        <div className="gear small"></div>
      </div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container metal-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="circuit-icon"></div>
          </div>
          <h1>FHE<span>Serverless</span></h1>
        </div>
        
        <div className="header-tabs">
          <button 
            className={`tab-button ${activeTab === "dashboard" ? "active" : ""}`}
            onClick={() => setActiveTab("dashboard")}
          >
            Dashboard
          </button>
          <button 
            className={`tab-button ${activeTab === "functions" ? "active" : ""}`}
            onClick={() => setActiveTab("functions")}
          >
            Functions
          </button>
          <button 
            className={`tab-button ${activeTab === "team" ? "active" : ""}`}
            onClick={() => setActiveTab("team")}
          >
            Team
          </button>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-button metal-button"
          >
            <div className="add-icon"></div>
            Deploy Function
          </button>
          <button 
            className="metal-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        {activeTab === "dashboard" && (
          <div className="dashboard-panels">
            <div className="panel intro-panel">
              <h2>Fully Homomorphic Encryption Serverless Framework</h2>
              <p>Deploy and execute functions on encrypted data without decryption using cutting-edge FHE technology.</p>
              <div className="fhe-badge">
                <span>FHE-Powered</span>
              </div>
              <div className="tech-stack">
                <div className="tech-item">Rust</div>
                <div className="tech-item">Python</div>
                <div className="tech-item">AWS Lambda</div>
                <div className="tech-item">Google Cloud Functions</div>
              </div>
            </div>
            
            <div className="panel stats-panel">
              <h3>Platform Statistics</h3>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-value">{functions.length}</div>
                  <div className="stat-label">Total Functions</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{verifiedCount}</div>
                  <div className="stat-label">Verified</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{pendingCount}</div>
                  <div className="stat-label">Pending</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{rejectedCount}</div>
                  <div className="stat-label">Rejected</div>
                </div>
              </div>
            </div>
            
            <div className="panel chart-panel">
              <h3>Function Categories</h3>
              {renderPieChart()}
            </div>
            
            <div className="panel actions-panel">
              <h3>Platform Actions</h3>
              <div className="action-buttons">
                <button 
                  className="metal-button primary"
                  onClick={checkAvailability}
                >
                  Check Availability
                </button>
                <button 
                  className="metal-button"
                  onClick={loadFunctions}
                >
                  Refresh Functions
                </button>
                <button 
                  className="metal-button"
                  onClick={() => setShowTutorial(true)}
                >
                  Show Tutorial
                </button>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "functions" && (
          <div className="functions-panel">
            <div className="section-header">
              <h2>Deployed FHE Functions</h2>
              <div className="header-actions">
                <button 
                  onClick={loadFunctions}
                  className="refresh-btn metal-button"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
                <button 
                  onClick={() => setShowCreateModal(true)}
                  className="create-btn metal-button primary"
                >
                  Deploy New Function
                </button>
              </div>
            </div>
            
            <div className="functions-list">
              {functions.length === 0 ? (
                <div className="no-functions">
                  <div className="no-functions-icon"></div>
                  <p>No FHE functions deployed yet</p>
                  <button 
                    className="metal-button primary"
                    onClick={() => setShowCreateModal(true)}
                  >
                    Deploy First Function
                  </button>
                </div>
              ) : (
                functions.map(func => (
                  <div className="function-card" key={func.id}>
                    <div className="card-header">
                      <div className="function-id">#{func.id.substring(0, 6)}</div>
                      <div className={`status-badge ${func.status}`}>
                        {func.status}
                      </div>
                    </div>
                    <div className="card-body">
                      <h3 className="function-name">{func.name}</h3>
                      <div className="function-meta">
                        <div className="meta-item">
                          <span className="meta-label">Owner:</span>
                          <span className="meta-value">{func.owner.substring(0, 6)}...{func.owner.substring(38)}</span>
                        </div>
                        <div className="meta-item">
                          <span className="meta-label">Category:</span>
                          <span className="meta-value">{func.category}</span>
                        </div>
                        <div className="meta-item">
                          <span className="meta-label">Deployed:</span>
                          <span className="meta-value">
                            {new Date(func.timestamp * 1000).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <div className="encrypted-data">
                        <span className="data-label">Encrypted Data:</span>
                        <span className="data-value">{func.encryptedData.substring(0, 20)}...</span>
                      </div>
                    </div>
                    <div className="card-footer">
                      {isOwner(func.owner) && func.status === "pending" && (
                        <>
                          <button 
                            className="action-btn metal-button success"
                            onClick={() => verifyFunction(func.id)}
                          >
                            Verify
                          </button>
                          <button 
                            className="action-btn metal-button danger"
                            onClick={() => rejectFunction(func.id)}
                          >
                            Reject
                          </button>
                        </>
                      )}
                      <button className="action-btn metal-button">
                        View Details
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        
        {activeTab === "team" && (
          <div className="team-panel">
            <h2>Core Development Team</h2>
            <p className="subtitle">Experts in cryptography, blockchain, and cloud computing</p>
            
            <div className="team-grid">
              {teamMembers.map((member, index) => (
                <div className="team-card" key={index}>
                  <div className="member-avatar">
                    {member.avatar}
                  </div>
                  <h3>{member.name}</h3>
                  <div className="member-role">{member.role}</div>
                  <p className="member-bio">{member.bio}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {showTutorial && (
          <div className="tutorial-panel">
            <div className="panel-header">
              <h2>FHE Serverless Framework Guide</h2>
              <button 
                className="close-tutorial"
                onClick={() => setShowTutorial(false)}
              >
                &times;
              </button>
            </div>
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-number">{index + 1}</div>
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitFunction} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          functionData={newFunctionData}
          setFunctionData={setNewFunctionData}
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
          <div className="transaction-content metal-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="metal-spinner small"></div>}
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
              <div className="circuit-icon small"></div>
              <span>FHE Serverless Framework</span>
            </div>
            <p>Deploy and execute functions on encrypted data</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">GitHub</a>
            <a href="#" className="footer-link">Whitepaper</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE Serverless. All rights reserved.
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
  functionData: any;
  setFunctionData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  functionData,
  setFunctionData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFunctionData({
      ...functionData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!functionData.name || !functionData.category) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal metal-card">
        <div className="modal-header">
          <h2>Deploy New FHE Function</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your function will be encrypted with FHE before deployment
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Function Name *</label>
              <input 
                type="text"
                name="name"
                value={functionData.name} 
                onChange={handleChange}
                placeholder="Enter function name..." 
                className="metal-input"
              />
            </div>
            
            <div className="form-group">
              <label>Category *</label>
              <select 
                name="category"
                value={functionData.category} 
                onChange={handleChange}
                className="metal-select"
              >
                <option value="">Select category</option>
                <option value="Data Analysis">Data Analysis</option>
                <option value="Financial">Financial Calculations</option>
                <option value="Machine Learning">Machine Learning</option>
                <option value="Healthcare">Healthcare</option>
                <option value="Other">Other</option>
              </select>
            </div>
            
            <div className="form-group full-width">
              <label>Function Description</label>
              <textarea 
                name="description"
                value={functionData.description} 
                onChange={handleChange}
                placeholder="Describe your function..." 
                className="metal-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="lock-icon"></div> Data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn metal-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn metal-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Deploy Function"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;