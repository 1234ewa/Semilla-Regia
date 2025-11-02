// js/wallet-connect.js
(function () {
    // Bandera para saber que el archivo sí cargó
    window.__WALLET_CONNECTOR_FILE_LOADED__ = true;
  
    const must = (cond, msg) => { if (!cond) throw new Error(msg); };
  
    try {
      must(typeof window !== 'undefined', 'window no disponible');
      
      // Verificar ethers con mensaje más claro
      if (!window.ethers) {
        console.error('ERROR: window.ethers no está disponible.');
        console.error('Asegúrate de que el script de ethers.js se cargue ANTES de wallet-connect.js');
        console.error('URL esperada: https://cdn.jsdelivr.net/npm/ethers@6.13.2/dist/ethers.umd.min.js');
        throw new Error('Ethers no está cargado. Verifica que el script de ethers.js se incluya antes de este archivo.');
      }
  
      const CFG = window.CONTRACT_CONFIG;
      const ABI = window.CONTRACT_ABI;
  
      must(!!CFG, 'CONFIG no cargado (js/config.js).');
      must(!!ABI, 'ABI no cargado (js/abi.js).');
  
      class ContractInteraction {
        constructor(provider, signer, address, abi) {
          this.provider = provider;
          this.signer = signer;
          this.address = address;
          this.contract = new ethers.Contract(address, abi, signer);
          this._fundingInProgress = false;
        }
        async checkNetwork() {
          const net = await this.provider.getNetwork();
          if (Number(net.chainId) !== CFG.chainId) {
            try {
              await window.ethereum.request({
                method: "wallet_switchEthereumChain",
                params: [{ chainId: CFG.chainIdHex }]
              });
            } catch (err) {
              if (err.code === 4902) {
                await window.ethereum.request({
                  method: "wallet_addEthereumChain",
                  params: [{
                    chainId: CFG.chainIdHex,
                    chainName: CFG.chainName,
                    nativeCurrency: CFG.currency,
                    rpcUrls: CFG.rpcUrls,
                    blockExplorerUrls: [CFG.blockExplorer]
                  }]
                });
              } else {
                throw err;
              }
            }
          }
        }
        async initializeUser() {
          try {
            await this.checkNetwork();
            
            // Intentar enviar con gasLimit manual para evitar estimateGas que puede fallar con Stylus
            let tx;
            let txHash = null;
            
            try {
              tx = await this.contract.initializeUser();
              if (tx?.hash && /^0x[a-fA-F0-9]{64}$/.test(tx.hash)) {
                txHash = tx.hash;
              }
            } catch (estimateErr) {
              // Si falla la estimación (común con Stylus), reintentamos con gasLimit fijo
              if (estimateErr.code === "CALL_EXCEPTION" || estimateErr.message?.includes("execution reverted") || estimateErr.code === "UNKNOWN_ERROR") {
                console.warn("estimateGas falló en initializeUser, reintentando con gasLimit manual...");
                try {
                  tx = await this.contract.initializeUser({ gasLimit: 100000 });
                  if (tx?.hash && /^0x[a-fA-F0-9]{64}$/.test(tx.hash)) {
                    txHash = tx.hash;
                  }
                } catch (retryErr) {
                  // Si falla pero hay hash en el error
                  const errMsg = String(retryErr.message || "");
                  const errStr = JSON.stringify(retryErr);
                  const hashMatch = (errMsg + errStr).match(/0x[a-fA-F0-9]{64}\b/g);
                  if (hashMatch && hashMatch[0].length === 66) {
                    txHash = hashMatch[0];
                  } else {
                    throw retryErr;
                  }
                }
              } else {
                throw estimateErr;
              }
            }
            
            let receipt = null;
            if (txHash) {
              try {
                if (tx && typeof tx.wait === 'function') {
                  receipt = await tx.wait();
                }
              } catch (waitErr) {
                // Si falla con "Decoding failed" pero tenemos hash, la transacción probablemente fue exitosa
                if ((waitErr.message?.includes("Decoding failed") || waitErr.code === "UNKNOWN_ERROR") && txHash) {
                  console.warn("Warning: tx.wait() falló al decodificar, pero la transacción tiene hash:", txHash);
                  // Verificar el estado real consultando el provider
                  try {
                    const txReceipt = await this.provider.getTransactionReceipt(txHash);
                    if (txReceipt) {
                      receipt = txReceipt;
                    }
                  } catch (checkErr) {
                    console.warn("No se pudo verificar el estado de initializeUser:", checkErr);
                  }
                } else {
                  throw waitErr;
                }
              }
            }
            
            return { success: true, txHash: txHash, receipt: receipt };
          } catch (e) {
            return { success: false, error: e.message || String(e) };
          }
        }
        
        async requestLoan() {
          try {
            await this.checkNetwork();
            
            // Intentar enviar con gasLimit manual para evitar estimateGas que puede fallar con Stylus
            let tx;
            try {
              tx = await this.contract.requestLoan();
            } catch (estimateErr) {
              // Si falla la estimación (común con Stylus), reintentamos con gasLimit fijo
              if (estimateErr.code === "CALL_EXCEPTION" || estimateErr.message?.includes("execution reverted")) {
                console.warn("estimateGas falló, reintentando con gasLimit manual...");
                tx = await this.contract.requestLoan({ gasLimit: 100000 });
              } else {
                throw estimateErr;
              }
            }
            
            const txHash = tx.hash; // Capturar hash antes de wait()
            
            let receipt = null;
            try {
              receipt = await tx.wait();
            } catch (waitErr) {
              // Si falla con "Decoding failed" pero tenemos hash, la transacción probablemente fue exitosa
              if ((waitErr.message?.includes("Decoding failed") || waitErr.code === "UNKNOWN_ERROR") && txHash) {
                console.warn("Warning: tx.wait() falló al decodificar, pero la transacción tiene hash:", txHash);
                // Retornamos éxito con el hash aunque no tengamos el recibo
              } else {
                throw waitErr;
              }
            }
            
            return { success: true, txHash: txHash, receipt: receipt };
          } catch (e) {
            return { success: false, error: e.message || String(e) };
          }
        }
        
        async fundRequest(borrower, amountEth) {
          try {
            if (this._fundingInProgress) {
              return { success: false, error: 'Ya hay una transacción en curso. Espera a que finalice.' };
            }
            this._fundingInProgress = true;
            await this.checkNetwork();
            const value = ethers.parseEther(String(amountEth));
            
            let tx;
            let txHash = null;
            
            try {
              // Enviar solo UNA transacción con gasLimit fijo para evitar dobles firmas
              if (typeof this.contract["transfer"] === 'function') {
                tx = await this.contract.transfer(borrower, { value, gasLimit: 150000 });
              } else {
                tx = await this.contract.fundRequest(borrower, { value, gasLimit: 150000 });
              }
              console.log("Transacción enviada, objeto tx:", tx);
              console.log("tx.hash:", tx?.hash);
              console.log("Tipo de tx.hash:", typeof tx?.hash);
              
              // Verificar que el hash sea válido (debe tener 66 caracteres: 0x + 64 hex)
              if (tx?.hash && /^0x[a-fA-F0-9]{64}$/.test(tx.hash)) {
                txHash = tx.hash;
                console.log("Hash válido capturado:", txHash);
              } else {
                console.error("Hash de transacción inválido o no disponible:", tx?.hash);
                console.error("Propiedades de tx:", Object.keys(tx || {}));
                // Intentar obtener el hash del error si está disponible
                if (tx && typeof tx.hash === 'string' && tx.hash.length > 0) {
                  console.error("Hash encontrado pero con formato incorrecto. Longitud:", tx.hash.length);
                }
                throw new Error("No se obtuvo un hash de transacción válido. La transacción puede no haberse enviado correctamente.");
              }
            } catch (estimateErr) {
              // Evitar múltiples firmas: no reintentar con otra transacción.
              throw estimateErr;
            }
            
            // Si tenemos hash pero no tx, crear un objeto mínimo
            if (txHash && !tx) {
              tx = { hash: txHash };
            }
            
            // Validar que el hash sea correcto antes de continuar
            if (!txHash) {
              throw new Error("No se pudo obtener el hash de la transacción");
            }
            
            if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
              console.error("Hash inválido detectado:", txHash);
              throw new Error(`Hash de transacción inválido: ${txHash}. Debe tener 66 caracteres (0x + 64 hex).`);
            }
            
            let receipt = null;
            try {
              if (tx && typeof tx.wait === 'function') {
                receipt = await tx.wait();
                // Verificar si la transacción fue revertida
                if (receipt && receipt.status === 0) {
                  throw new Error("La transacción fue revertida por el contrato. Posiblemente el borrower no tiene una solicitud activa.");
                }
              }
            } catch (waitErr) {
              // Verificar si el error indica que la transacción falló
              if (waitErr.message?.includes("reverted") || waitErr.message?.includes("revert")) {
                throw new Error("La transacción fue revertida. El borrower probablemente no tiene una solicitud activa en el contrato. Debe ejecutar requestLoan() primero.");
              }
              
              // Si wait falla con "Decoding failed" pero tenemos hash válido, considerar éxito
              // Esto es común con contratos Stylus que no pueden decodificar las respuestas
              if ((waitErr.message?.includes("Decoding failed") || waitErr.code === "UNKNOWN_ERROR") && txHash) {
                console.warn("tx.wait() falló con 'Decoding failed', pero tenemos hash válido:", txHash);
                console.warn("Intentando verificar estado de la transacción en el provider...");
                
                // Intentar verificar el estado de la transacción consultando el provider
                try {
                  // Esperar un poco antes de consultar el receipt (puede tardar en estar disponible)
                  await new Promise(resolve => setTimeout(resolve, 2000));
                  const txReceipt = await this.provider.getTransactionReceipt(txHash);
                  if (txReceipt) {
                    if (txReceipt.status === 0) {
                      throw new Error("La transacción fue revertida por el contrato. Verifica que el borrower tenga una solicitud activa.");
                    }
                    receipt = txReceipt;
                    console.log("✅ Receipt obtenido del provider, transacción exitosa:", txReceipt.status === 1);
                  } else {
                    console.warn("⚠️ Receipt no disponible aún, pero hash válido:", txHash);
                    // Si no hay receipt pero tenemos hash válido, considerar éxito (la transacción está en la mempool)
                  }
                } catch (checkErr) {
                  console.warn("No se pudo obtener receipt del provider:", checkErr.message);
                  // Si no podemos obtener el receipt pero tenemos un hash válido, 
                  // consideramos éxito (la transacción fue enviada y está en la mempool)
                }
                
                // Si tenemos hash válido, retornar éxito aunque tx.wait() haya fallado
                // El usuario puede verificar en el explorer
                return { success: true, txHash: txHash, receipt: receipt };
              } else if (!waitErr.message?.includes("Decoding failed") && !waitErr.message?.includes("reverted")) {
                // Solo propagar si no es "Decoding failed" ni "reverted"
                throw waitErr;
              } else {
                // Si es "Decoding failed" pero no tenemos hash, propagar el error
                throw waitErr;
              }
            }
            
            return { success: true, txHash: txHash, receipt: receipt };
          } catch (e) {
            // Intentar extraer hash REAL del error si existe (debe ser exactamente 66 caracteres)
            const errMsg = String(e.message || e.toString() || "");
            const errStr = JSON.stringify(e);
            const hashMatch = (errMsg + errStr).match(/0x[a-fA-F0-9]{64}\b/g);
            
            // Si el error es "Decoding failed" o "UNKNOWN_ERROR", podría ser que la transacción sí se envió
            // pero ethers.js no pudo decodificar la respuesta (común con Stylus)
            if ((errMsg.includes("Decoding failed") || e.code === "UNKNOWN_ERROR") && !hashMatch) {
              console.warn("Error 'Decoding failed' sin hash válido detectado. El contrato puede haber revertido.");
              console.warn("Posibles causas:");
              console.warn("1. El borrower no tiene una solicitud activa en el contrato");
              console.warn("2. El monto enviado no es exactamente el requerido");
              console.warn("3. El borrower ya tiene un lender asignado");
            }
            
            // Solo considerar éxito si encontramos un hash válido (66 caracteres)
            if (hashMatch) {
              const candidate = hashMatch[0];
              if (candidate.length === 66) {
                console.warn("Hash de transacción válido detectado en el error:", candidate);
                return { success: true, txHash: candidate, receipt: null };
              } else {
                console.warn("Se encontró un hash pero no es válido (puede ser data de la transacción):", candidate);
              }
            }
            
            // Mejorar el mensaje de error para el usuario
            let userMessage = e.message || String(e);
            if (errMsg.includes("Decoding failed") || errMsg.includes("Internal JSON-RPC error")) {
              // Si el contrato actual expone transfer(), usamos mensaje genérico (no de préstamos)
              if (typeof this.contract["transfer"] === 'function') {
                userMessage = "La transacción no pudo confirmarse. Verifica en el explorer si se ejecutó o inténtalo de nuevo.";
              } else {
                userMessage = "La transacción falló. Posibles causas:\n- El borrower no tiene una solicitud activa\n- El monto no coincide (0.0000001 ETH)\n- El borrower ya tiene un lender\n\nRevisa la consola para más detalles.";
              }
            }
            
            return { success: false, error: userMessage };
          }
          finally {
            this._fundingInProgress = false;
          }
        }
        
        async payInstallment(amountEth) {
          try {
            await this.checkNetwork();
            const value = ethers.parseEther(String(amountEth || "0"));
            
            let tx;
            try {
              tx = await this.contract.payInstallment({ value });
            } catch (estimateErr) {
              if (estimateErr.code === "CALL_EXCEPTION" || estimateErr.message?.includes("execution reverted")) {
                console.warn("estimateGas falló, reintentando con gasLimit manual...");
                tx = await this.contract.payInstallment({ value, gasLimit: 100000 });
              } else {
                throw estimateErr;
              }
            }
            
            const txHash = tx.hash;
            
            let receipt = null;
            try {
              receipt = await tx.wait();
            } catch (waitErr) {
              if ((waitErr.message?.includes("Decoding failed") || waitErr.code === "UNKNOWN_ERROR") && txHash) {
                console.warn("Warning: tx.wait() falló al decodificar, pero la transacción tiene hash:", txHash);
              } else {
                throw waitErr;
              }
            }
            
            return { success: true, txHash: txHash, receipt: receipt };
          } catch (e) {
            return { success: false, error: e.message || String(e) };
          }
        }
        
        async checkAndMarkDefault(borrower) {
          try {
            await this.checkNetwork();
            const tx = await this.contract.checkAndMarkDefault(borrower);
            const txHash = tx.hash;
            
            let receipt = null;
            try {
              receipt = await tx.wait();
            } catch (waitErr) {
              if ((waitErr.message?.includes("Decoding failed") || waitErr.code === "UNKNOWN_ERROR") && txHash) {
                console.warn("Warning: tx.wait() falló al decodificar, pero la transacción tiene hash:", txHash);
              } else {
                throw waitErr;
              }
            }
            
            return { success: true, txHash: txHash, receipt: receipt };
          } catch (e) {
            return { success: false, error: e.message || String(e) };
          }
        }
      }
  
      class WalletConnector {
        constructor() {
          this.isConnected = false;
          this.walletAddress = null;
          this.provider = null;
          this.signer = null;
          this.contractInteraction = null;
          this.session = null;
          this._setupEvents();
        }
        _setupEvents() {
          if (!window.ethereum) return;
          window.ethereum.on?.('accountsChanged', (accs) => {
            if (accs && accs.length) {
              this.walletAddress = accs[0];
              this.isConnected = true;
              if (this.session) {
                this.session.address = this.walletAddress;
                try { localStorage.setItem('walletSession', JSON.stringify(this.session)); } catch {}
              }
            } else {
              this.disconnect('accountsChanged');
            }
          });
          window.ethereum.on?.('chainChanged', () => window.location.reload());
        }
        async connect(options) {
          if (this.isConnected && this.walletAddress && this.signer) {
            return { address: this.walletAddress, chainId: CFG.chainId, signature: this.session?.signature };
          }
          if (!window.ethereum) {
            throw new Error('No se detectó MetaMask. Instálalo o habilítalo.');
          }
          this.provider = new ethers.BrowserProvider(window.ethereum);
  
          // Solicita cuentas
          await window.ethereum.request({ method: 'eth_requestAccounts' });
  
          // Asegura red
          const net = await this.provider.getNetwork();
          if (Number(net.chainId) !== CFG.chainId) {
            try {
              await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: CFG.chainIdHex }]
              });
            } catch (err) {
              if (err.code === 4902) {
                await window.ethereum.request({
                  method: 'wallet_addEthereumChain',
                  params: [{
                    chainId: CFG.chainIdHex,
                    chainName: CFG.chainName,
                    nativeCurrency: CFG.currency,
                    rpcUrls: CFG.rpcUrls,
                    blockExplorerUrls: [CFG.blockExplorer]
                  }]
                });
              } else {
                throw err;
              }
            }
          }
  
          const accounts = await this.provider.send('eth_accounts', []);
          if (!accounts || !accounts.length) {
            throw new Error('No se obtuvo ninguna cuenta desde MetaMask.');
          }
  
          this.walletAddress = accounts[0];
          this.signer = await this.provider.getSigner();
          this.contractInteraction = new ContractInteraction(this.provider, this.signer, CFG.address, ABI);
          this.isConnected = true;

          const requireSignature = options?.requireSignature !== false; // por defecto true, pero demo puede desactivarla
          let message, signature;
          if (requireSignature) {
            message = `SEMILLA REGÍA\n\nConexión a dApp\nDirección: ${this.walletAddress}\nNonce: ${Date.now()}`;
            try {
              signature = await this.signer.signMessage(message);
            } catch (err) {
              this.disconnect('signature-rejected');
              throw new Error('Debes firmar el mensaje de conexión para continuar.');
            }
          }

          this.session = {
            address: this.walletAddress,
            chainId: CFG.chainId,
            message,
            signature,
            connectedAt: new Date().toISOString()
          };

          try {
            localStorage.setItem('walletSession', JSON.stringify(this.session));
          } catch (err) {
            console.warn('No se pudo guardar walletSession', err);
          }
  
          // Notifica a la UI si alguien quiere escuchar
          window.dispatchEvent(new CustomEvent('wallet:connected', {
            detail: { address: this.walletAddress, chainId: CFG.chainId, signature }
          }));
  
          return { address: this.walletAddress, chainId: CFG.chainId, signature };
        }
        getProvider() { return this.provider; }
        getContractInteraction() { return this.contractInteraction; }
        getSession() { return this.session; }

        disconnect(reason = 'user') {
          this.isConnected = false;
          this.walletAddress = null;
          this.signer = null;
          this.contractInteraction = null;
          this.session = null;
          try {
            localStorage.removeItem('walletSession');
          } catch (err) {
            console.warn('No se pudo limpiar walletSession', err);
          }
          window.dispatchEvent(new CustomEvent('wallet:disconnected', { detail: { reason } }));
        }
        async initializeUserIfNeeded() {
          try {
            if (!this.contractInteraction) throw new Error('Contrato no inicializado');
            await this.contractInteraction.checkNetwork();
            if (!this.walletAddress) throw new Error('No hay wallet conectada');

            const readLimit = async () => {
              try {
                return await this.contractInteraction.contract.getLimit(this.walletAddress);
              } catch (err) {
                console.warn('No se pudo leer getLimit() dentro de initializeUserIfNeeded:', err);
                return 0n;
              }
            };

            let limit = await readLimit();
            if (limit > 0n) {
              localStorage.setItem('userInitialized', this.walletAddress);
              return { success: true, alreadyInitialized: true };
            }
            try {
              let tx;
              try {
                tx = await this.contractInteraction.contract.initializeUser();
              } catch (estimateErr) {
                if (estimateErr.code === "CALL_EXCEPTION" || estimateErr.message?.includes("execution reverted")) {
                  console.warn("estimateGas falló en initializeUser, reintentando con gasLimit manual...");
                  tx = await this.contractInteraction.contract.initializeUser({ gasLimit: 100000 });
                } else {
                  throw estimateErr;
                }
              }
              
              const txHash = tx.hash; // Capturar hash antes de wait()
              
              let receipt = null;
              try {
                receipt = await tx.wait();
              } catch (waitErr) {
                // Si falla con "Decoding failed" pero tenemos hash, la transacción probablemente fue exitosa
                if ((waitErr.message?.includes("Decoding failed") || waitErr.code === "UNKNOWN_ERROR") && txHash) {
                  console.warn("Warning: tx.wait() falló al decodificar, pero la transacción tiene hash:", txHash);
                  // Continuamos, la transacción probablemente fue exitosa
                } else {
                  throw waitErr;
                }
              }
              
              localStorage.setItem('userInitialized', this.walletAddress);
              limit = await readLimit();
              return { success: true, txHash: txHash, receipt: receipt, alreadyInitialized: false, limit };
            } catch (e) {
              const m = (e.message || '').toLowerCase();
              // Si es "Decoding failed" con hash, o "already initialized", lo consideramos éxito
              if (m.includes('already') || m.includes('initialized') || m.includes('decoding failed')) {
                limit = await readLimit();
                if (limit > 0n) {
                  localStorage.setItem('userInitialized', this.walletAddress);
                  return { success: true, alreadyInitialized: true, limit };
                }
                localStorage.setItem('userInitialized', this.walletAddress);
                return { success: true, alreadyInitialized: true, limit: 0n };
              }
              return { success: false, error: e.message || String(e) };
            }
          } catch (e) {
            return { success: false, error: e.message || String(e) };
          }
        }
      }
  
      // Exponer en window
      window.walletConnector = new WalletConnector();
      console.log('[wallet-connect] listo ✅');
  
    } catch (err) {
      console.error('[wallet-connect] fallo al inicializar ❌', err);
      // Evita que tu main.js truene
      window.walletConnector = {
        isConnected: false,
        connect: async () => { throw err; },
        getProvider: () => null,
        getContractInteraction: () => null
      };
    }
  })();
  