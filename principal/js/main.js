// js/main.js

/*******************
 * Utilidades base *
 *******************/
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const fmtEth = (weiLike) => {
  try {
    const v = typeof weiLike === "bigint" ? weiLike : BigInt(weiLike);
    return (Number(v) / 1e18).toFixed(6);
  } catch {
    return "-";
  }
};

const toWei = (ethStr) => {
  const n = Number(ethStr);
  if (isNaN(n) || n < 0) throw new Error("Monto inválido");
  if (window.ethers?.parseEther) return window.ethers.parseEther(String(ethStr));
  return BigInt(Math.floor(n * 1e18));
};

const buildTxLink = (hash) => {
  const base = (window.CONTRACT_CONFIG && window.CONTRACT_CONFIG.blockExplorer) || "https://sepolia.arbiscan.io";
  return `${base}/tx/${hash}`;
};

// Config visual de solicitud
const LOAN_AMOUNT_USD_DEFAULT = 100;
const INTEREST_PERCENT = 15; // porcentaje de interés a mostrar

// Toast simple para mensajes breves
function showToast(message) {
  try {
    let container = document.getElementById("toastContainer");
    if (!container) {
      container = document.createElement("div");
      container.id = "toastContainer";
      container.style.position = "fixed";
      container.style.right = "20px";
      container.style.bottom = "20px";
      container.style.zIndex = "2000";
      container.style.display = "flex";
      container.style.flexDirection = "column";
      container.style.gap = "10px";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.textContent = message;
    toast.style.padding = "12px 16px";
    toast.style.background = "#0a7";
    toast.style.color = "#fff";
    toast.style.borderRadius = "8px";
    toast.style.boxShadow = "0 6px 16px rgba(0,0,0,.15)";
    toast.style.fontSize = "14px";
    toast.style.fontWeight = "600";
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    toast.style.transition = "all .25s ease";
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";
    });

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
      setTimeout(() => toast.remove(), 250);
    }, 2500);
  } catch {}
}

// Monto fijo del contrato en ETH (el contrato requiere exactamente este valor)
const CONTRACT_LOAN_AMOUNT_ETH = "0.0000001";

// Conversión de USD a ETH (tasa aproximada: 1 ETH = $3000 USD)
// NOTA: Solo para visualización. El contrato siempre usa 0.0000001 ETH
const USD_TO_ETH_RATE = 3000; // 1 ETH = $3000 USD (aproximado)
const convertUsdToEth = (usdAmount) => {
  return (usdAmount / USD_TO_ETH_RATE).toFixed(8);
};

// Modo silencioso: sin popups nativos (alert/confirm)
const UI_SILENT = true;
document.addEventListener("DOMContentLoaded", () => {
  if (UI_SILENT) {
    try {
      window.alert = function () {};
      window.confirm = function () { return true; };
    } catch {}
  }
});

const LOAN_CACHE_KEY = "cachedLoanRequests";
const FIXED_BORROWER_ADDRESS = "0x5728db90889ac3d5fd0a41286ca2480abcefe2a0";

// Limpiar cache de préstamos al cargar la página (para pruebas desde cero)
const clearLoanCache = () => {
  try {
    localStorage.removeItem(LOAN_CACHE_KEY);
    console.log("✅ Cache de préstamos limpiada");
  } catch (error) {
    console.warn("No se pudo limpiar cache de préstamos", error);
  }
};

// Ejecutar limpieza al cargar
clearLoanCache();

const loadCachedLoanRequests = () => {
  try {
    const raw = localStorage.getItem(LOAN_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("No se pudo leer cache de préstamos", error);
    return [];
  }
};

const saveCachedLoanRequests = (list) => {
  try {
    localStorage.setItem(LOAN_CACHE_KEY, JSON.stringify(list));
  } catch (error) {
    console.warn("No se pudo guardar cache de préstamos", error);
  }
};

const upsertLoanRequestCache = (entry) => {
  if (!entry?.borrower) return;
  const list = loadCachedLoanRequests();
  const idx = list.findIndex((item) => item.borrower?.toLowerCase() === entry.borrower.toLowerCase());
  const enriched = {
    createdAt: new Date().toISOString(),
    status: "pending",
    ...list[idx],
    ...entry,
    updatedAt: new Date().toISOString()
  };
  if (idx >= 0) {
    list[idx] = enriched;
  } else {
    list.push(enriched);
  }
  saveCachedLoanRequests(list);
  return list;
};

const markLoanRequestFunded = (borrower, txHash) => {
  if (!borrower) return;
  const list = loadCachedLoanRequests();
  const idx = list.findIndex((item) => item.borrower?.toLowerCase() === borrower.toLowerCase());
  if (idx >= 0) {
    list[idx] = {
      ...list[idx],
      status: "funded",
      fundedTxHash: txHash || list[idx].fundedTxHash,
      fundedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    saveCachedLoanRequests(list);
  }
  return list;
};

async function preflightCheck() {
  const walletConnector = window.walletConnector;
  if (!walletConnector) throw new Error("Conector de wallet no disponible.");
  if (!walletConnector.isConnected) throw new Error("Por favor, conecta tu wallet.");

  const provider = walletConnector.getProvider?.();
  const interaction = walletConnector.getContractInteraction?.();

  if (interaction?.checkNetwork) await interaction.checkNetwork();

  if (provider && window.CONTRACT_CONFIG?.address) {
    const code = await provider.getCode(window.CONTRACT_CONFIG.address);
    if (!code || code === "0x") {
      throw new Error("El contrato no está desplegado en esta red. Cambia a Arbitrum Sepolia.");
    }
  }
  return interaction;
}

/*****************************************************
 * Flujo robusto de solicitud de préstamo on-chain   *
 * (init -> checks -> requestLoan)                   *
 *****************************************************/
async function robustRequestLoan(interaction) {
  const me = window.walletConnector.walletAddress;

  const readLimit = async () => {
    try {
      return await interaction.contract.getLimit(me);
    } catch (err) {
      console.warn("No se pudo leer getLimit():", err);
      return 0n;
    }
  };

  let limit = await readLimit();

  // 1) Inicializa usuario solo si realmente no tiene límite establecido
  if (limit === 0n) {
    console.info("Usuario sin límite, se inicializa por primera vez.");
    try {
      let txInit;
      try {
        txInit = await interaction.contract.initializeUser();
      } catch (estimateErr) {
        if (estimateErr.code === "CALL_EXCEPTION" || estimateErr.message?.includes("execution reverted")) {
          console.warn("estimateGas falló en initializeUser, reintentando con gasLimit manual...");
          txInit = await interaction.contract.initializeUser({ gasLimit: 100000 });
        } else {
          throw estimateErr;
        }
      }

      const initHash = txInit.hash;
      try {
        await txInit.wait();
      } catch (waitErr) {
        if ((waitErr.message?.includes("Decoding failed") || waitErr.code === "UNKNOWN_ERROR") && initHash) {
          console.warn("tx.wait() falló al decodificar en initializeUser, hash:", initHash);
        } else {
          throw waitErr;
        }
      }

      limit = await readLimit();
      if (limit === 0n) {
        throw new Error("No se pudo inicializar tu perfil. Intenta de nuevo.");
      }
    } catch (e) {
      const m = (e?.message || "").toLowerCase();
      if (!m.includes("already") && !m.includes("initialized") && !m.includes("decoding failed")) {
        throw e;
      }
      // si cae aquí es porque el contrato devolvió mensaje conocido; re-lee límite
      limit = await readLimit();
      if (limit === 0n) {
        throw new Error("Tu usuario no está inicializado. Vuelve a intentar o refresca la página.");
      }
    }
  } else {
    console.info("Usuario ya inicializado; se omite initializeUser().");
  }

  // 2) Validaciones previas
  const isDef = await interaction.contract.isDefaulted(me);
  if (isDef) {
    throw new Error("Tu cuenta está en estado de default. No puedes solicitar un préstamo.");
  }

  // 2b) Verifica que no exista ya un préstamo activo
  try {
    const info = await interaction.contract.getLoanInfo(me);
    const deudaActual = info?.[0] ?? 0n;
    const tieneActivo = info?.[1] ?? false;
    const prestamista = info?.[2] ?? ethers.ZeroAddress;

    if (tieneActivo || deudaActual > 0n) {
      let msg = "Ya tienes un préstamo activo en el contrato.";
      if (prestamista === ethers.ZeroAddress) {
        msg += " Debe fondearse con fundRequest(borrower) antes de poder solicitar otro.";
      } else {
        msg += " Liquida tus cuotas llamando payInstallment() para liberar el límite.";
      }
      throw new Error(msg);
    }
  } catch (err) {
    // Si la lectura falla por algun motivo que no sea stylus revert, continúa
    const em = String(err?.message || "").toLowerCase();
    if (em.includes("decoding") || em.includes("revert")) {
      throw err; // error real que debemos mostrar
    }
    console.warn("No se pudo leer getLoanInfo():", err);
  }

  // 3) Ejecuta la solicitud
  let tx;
  try {
    tx = await interaction.contract.requestLoan();
  } catch (estimateErr) {
    // Si falla la estimación, reintentamos con gasLimit fijo
    if (estimateErr.code === "CALL_EXCEPTION" || estimateErr.message?.includes("execution reverted")) {
      console.warn("estimateGas falló en requestLoan, reintentando con gasLimit manual...");
      tx = await interaction.contract.requestLoan({ gasLimit: 100000 });
    } else {
      throw estimateErr;
    }
  }
  
  const txHash = tx.hash; // Capturar hash inmediatamente
  
  // Intentar esperar el recibo, pero si falla con "Decoding failed", igual retornamos éxito
  let receipt = null;
  try {
    receipt = await tx.wait();
  } catch (waitErr) {
    if (waitErr.message?.includes("Decoding failed") || waitErr.code === "UNKNOWN_ERROR") {
      console.warn("Warning: tx.wait() falló al decodificar, pero la transacción tiene hash:", txHash);
      console.warn("La transacción probablemente fue exitosa. Verifica en el block explorer.");
      // No lanzamos error, retornamos éxito con el hash
    } else {
      throw waitErr;
    }
  }
  
  return { success: true, txHash: txHash, receipt: receipt };
}

/******************************
 * Banner superior (cerrar)   *
 ******************************/
document.addEventListener("DOMContentLoaded", () => {
  const bannerClose = document.querySelector(".banner-close");
  const topBanner = document.querySelector(".top-banner");
  if (bannerClose && topBanner) {
    bannerClose.addEventListener("click", () => (topBanner.style.display = "none"));
  }
});

/*****************************************
 * Interactividad de features (cards)     *
 *****************************************/
document.addEventListener("DOMContentLoaded", () => {
  const featureItems = $$(".feature-item");
  featureItems.forEach((item) => {
    item.addEventListener("click", function () {
      featureItems.forEach((f) => f.classList.remove("active"));
      this.classList.add("active");
      console.log("Feature seleccionado:", this.dataset.feature);
        });
    });
});

/*************************************
 * Tabs del board / secciones         *
 *************************************/
document.addEventListener("DOMContentLoaded", () => {
  const tabButtons = $$(".tab-btn");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", function () {
      tabButtons.forEach((t) => t.classList.remove("active"));
      this.classList.add("active");
      console.log("Vista seleccionada:", this.textContent);
        });
    });
});

/*******************************************
 * Checkboxes de tareas (tachado/opacity)  *
 *******************************************/
document.addEventListener("DOMContentLoaded", () => {
  const taskCheckboxes = $$(".task-checkbox");
  taskCheckboxes.forEach((cb) => {
    cb.addEventListener("change", function () {
      const taskItem = this.closest(".task-item");
      if (!taskItem) return;
            if (this.checked) {
        taskItem.style.opacity = "0.6";
        taskItem.style.textDecoration = "line-through";
            } else {
        taskItem.style.opacity = "1";
        taskItem.style.textDecoration = "none";
            }
        });
    });
});

/************************
 * Búsqueda de tareas   *
 ************************/
document.addEventListener("DOMContentLoaded", () => {
  const searchInput = $(".search-input");
  const taskItems = $$(".task-item");
    if (searchInput) {
    searchInput.addEventListener("input", function () {
      const q = this.value.toLowerCase();
      taskItems.forEach((it) => {
        const title = it.querySelector(".task-title");
        const txt = (title?.textContent || "").toLowerCase();
        it.style.display = txt.includes(q) ? "flex" : "none";
            });
        });
    }
});

/*************************
 * Chat bubble (mock)    *
 *************************/
document.addEventListener("DOMContentLoaded", () => {
  const chatBubble = $(".chat-bubble");
    if (chatBubble) {
    chatBubble.addEventListener("click", () => {
      alert("Funcionalidad de chat - Preparado para integración con wallet");
        });
    }
});

/***********************
 * Sidebar navegación  *
 ***********************/
document.addEventListener("DOMContentLoaded", () => {
  const sidebarLinks = $$(".sidebar-link");
  sidebarLinks.forEach((lnk) => {
    lnk.addEventListener("click", function (e) {
            e.preventDefault();
      sidebarLinks.forEach((l) => l.classList.remove("active"));
      this.classList.add("active");
      console.log("Navegación:", this.textContent.trim());
        });
    });
});

/*******************************
 * CTA / botones principales   *
 *******************************/
document.addEventListener("DOMContentLoaded", () => {
  const btnCta = $(".btn-cta");
  const btnPrimary = $(".btn-primary");
  const btnSecondary = $$(".btn-secondary");

  if (btnCta) btnCta.addEventListener("click", () => console.log("CTA clickeado - Integración wallet"));
  if (btnPrimary) btnPrimary.addEventListener("click", () => console.log("Registro clickeado"));
  btnSecondary.forEach((b) =>
    b.addEventListener("click", function () {
      console.log("Botón clickeado:", this.textContent.trim());
    })
  );
});

/******************************
 * Hover suave en interactivos *
 ******************************/
document.addEventListener("DOMContentLoaded", () => {
  const interactive = $$("button, a, .task-item, .feature-item");
  interactive.forEach((el) => {
    el.addEventListener("mouseenter", function () {
      this.style.transition = "all 0.2s ease";
        });
    });
});

/***********************
 * Responsive header    *
 ***********************/
function handleMobileMenu() {
  const headerNav = $(".header-nav");
  if (window.innerWidth <= 768 && headerNav) {
    headerNav.style.overflowX = "auto";
  }
}
window.addEventListener("resize", handleMobileMenu);
handleMobileMenu();

/*****************************************
 * Compatibilidad: ¿wallet conectada?    *
 *****************************************/
function checkWalletConnection() {
  const wc = window.walletConnector;
  return !!(wc && wc.isConnected);
}

/*********************************************
 * Botón conectar wallet (si existe en DOM)  *
 *********************************************/
document.addEventListener("DOMContentLoaded", () => {
  const statusNode = $("#statusMessage") || $("#status");
  const connectBtn = $("#walletBtn");
  const logoutBtn = $("#logoutBtn");

  const setUIConnected = ({ address, chainId }) => {
    if (statusNode) statusNode.textContent = "Wallet conectada";
    if (connectBtn) connectBtn.textContent = "Wallet conectada";
  };

  const setUIDisconnected = () => {
    if (statusNode) statusNode.textContent = "Wallet desconectada";
    if (connectBtn) connectBtn.textContent = "Conectar wallet";
  };

  if (connectBtn) {
    connectBtn.addEventListener("click", async () => {
      try {
        const res = await window.walletConnector.connect();
        setUIConnected(res || {});
      } catch (e) {
        alert(e.message || "No se pudo conectar la wallet");
            }
        });
    }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      if (!window.walletConnector?.isConnected) {
        alert("No hay una wallet conectada.");
        return;
      }
      window.walletConnector.disconnect('manual');
      setUIDisconnected();
    });
  }

  window.addEventListener("wallet:connected", (ev) => setUIConnected(ev.detail || {}));
  window.addEventListener("wallet:disconnected", () => setUIDisconnected());

  // Al refrescar la página, siempre cerrar sesión
  try {
    localStorage.removeItem('walletSession');
    if (window.walletConnector?.isConnected) {
      window.walletConnector.disconnect('page-refresh');
    }
  } catch (err) {
    console.warn('Error al limpiar sesión al refrescar', err);
  }
  setUIDisconnected();
});

/*************************************************************
 * Modal Solicitar Préstamo (loanForm) — versión simulada    *
 *************************************************************/
document.addEventListener("DOMContentLoaded", () => {
  const modal = $("#modalPrestamo");
  const btnSolicitar = document.querySelector(".btn-solicitar");
  const closeModal = $("#closeModal");
  const loanForm = $("#loanForm");
  const walletAddressInput = $("#walletAddress");
  const requestLoanBtn = $("#requestLoanBtn");

  function openModal() {
    if (modal) modal.classList.add("active");
    // Mostrar siempre la wallet fija por defecto (solo visual)
    if (walletAddressInput) {
      walletAddressInput.value = "0x5728db90889ac3d5fd0a41286ca2480abcefe2a0";
    }
    // El botón siempre está habilitado (cambios solo visuales)
    if (requestLoanBtn) {
      requestLoanBtn.disabled = false;
    }
    // Actualizar interés y total mostrado
    const ip = document.getElementById("interestPercent");
    const twi = document.getElementById("totalWithInterest");
    if (ip) ip.textContent = `${INTEREST_PERCENT}%`;
    if (twi) {
      const total = LOAN_AMOUNT_USD_DEFAULT * (1 + INTEREST_PERCENT / 100);
      twi.textContent = `$${total.toFixed(2)} USD`;
    }
    // Calcular cuotas (2 pagos iguales)
    const totalCalc = LOAN_AMOUNT_USD_DEFAULT * (1 + INTEREST_PERCENT / 100);
    const cuota = totalCalc / 2;
    const i1 = document.getElementById("installment1Amt");
    const i2 = document.getElementById("installment2Amt");
    if (i1) i1.textContent = `$${cuota.toFixed(2)} USD`;
    if (i2) i2.textContent = `$${cuota.toFixed(2)} USD`;
  }

  function closeModalFunc() {
    if (modal) modal.classList.remove("active");
  }

  if (btnSolicitar && modal) btnSolicitar.addEventListener("click", openModal);
  if (closeModal && modal) closeModal.addEventListener("click", closeModalFunc);
    if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModalFunc();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal?.classList.contains("active")) closeModalFunc();
  });

  // Event listeners para los campos de archivo (escanear ID) con simulación de subida
  // Estado temporal de archivos del formulario
  window._loanFormUploads = window._loanFormUploads || {};

  const scanId = $("#scanId");
  const scanIdPadre = $("#scanIdPadre");
  const scanIdMadre = $("#scanIdMadre");
  const scanIdStatus = $("#scanIdStatus");
  const scanIdPadreStatus = $("#scanIdPadreStatus");
  const scanIdMadreStatus = $("#scanIdMadreStatus");
  const businessPhoto = $("#businessPhoto");
  const businessPhotoStatus = $("#businessPhotoStatus");

  function simulateUpload(inputEl, statusEl) {
    if (!statusEl || !inputEl) return;
    statusEl.style.color = "#666";
    statusEl.textContent = "Subiendo...";
    inputEl.disabled = true;
    setTimeout(() => {
      statusEl.style.color = "#0a7";
      statusEl.textContent = "Archivo subido";
      inputEl.disabled = false;
      // Marcar bandera en memoria
      if (inputEl.id) {
        window._loanFormUploads[inputEl.id] = true;
      }
    }, 800);
  }

  function wireUploadSim(inputEl, statusEl) {
    if (!inputEl) return;
    inputEl.addEventListener("click", function() {
      simulateUpload(inputEl, statusEl);
    });
    inputEl.addEventListener("change", function() {
      simulateUpload(inputEl, statusEl);
      // Si es la foto del negocio, cargar vista previa en memoria (data URL)
      if (inputEl === businessPhoto && inputEl.files && inputEl.files[0]) {
        try {
          const reader = new FileReader();
          reader.onload = () => {
            window._loanFormUploads.businessPhotoDataUrl = reader.result;
          };
          reader.readAsDataURL(inputEl.files[0]);
        } catch {}
            }
        });
    }

  wireUploadSim(scanId, scanIdStatus);
  wireUploadSim(scanIdPadre, scanIdPadreStatus);
  wireUploadSim(scanIdMadre, scanIdMadreStatus);
  wireUploadSim(businessPhoto, businessPhotoStatus);

  if (loanForm) {
    loanForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            
      // Nota: flujo visual — permitimos registrar la solicitud sin conexión de wallet
            
      try {
        if (requestLoanBtn) {
          requestLoanBtn.disabled = true;
          requestLoanBtn.textContent = "Procesando...";
        }

        // Modo simulación: solo guarda en cache con borrower fijo mostrado en el formulario
        const borrower = FIXED_BORROWER_ADDRESS;
        
        // Monto para mostrar: $100 USD (solo visualización)
        // Monto real del contrato: siempre 0.0000001 ETH
        const loanAmountUsd = 100;
        const loanAmountEthDisplay = convertUsdToEth(loanAmountUsd); // Solo para mostrar
        const loanAmountEthReal = CONTRACT_LOAN_AMOUNT_ETH; // Valor real del contrato

        const businessDescriptionInput = document.getElementById("businessDescription");
        const businessDescription = (businessDescriptionInput?.value || "").trim();

        // Adjuntos simulados
        const uploads = window._loanFormUploads || {};
        const docs = {
          scanId: !!uploads.scanId,
          scanIdPadre: !!uploads.scanIdPadre,
          scanIdMadre: !!uploads.scanIdMadre
        };
        const businessPhotoDataUrl = uploads.businessPhotoDataUrl || null;

        upsertLoanRequestCache({
          borrower,
          amountEth: loanAmountEthReal,
          amountEthDisplay: loanAmountEthDisplay,
          amountUsd: loanAmountUsd,
          status: "pending",
          title: "Microemprendimiento de Benito Mendez",
          reason: businessDescription,
          businessPhotoDataUrl,
          docs
        });

        // Limpiar completamente el formulario y cerrar modal
        loanForm.reset();
        // Limpiar estados de subida y previews
        try {
          const ids = ["scanIdStatus", "scanIdPadreStatus", "scanIdMadreStatus", "businessPhotoStatus"]; 
          ids.forEach((id) => { const el = document.getElementById(id); if (el) el.textContent = ""; });
          const fileInputs = ["scanId", "scanIdPadre", "scanIdMadre", "businessPhoto"]; 
          fileInputs.forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
          window._loanFormUploads = {};
        } catch {}

        // Restaurar campos fijos tras reset
        const walletAddressInput = document.getElementById("walletAddress");
        const amountInput = document.getElementById("amount");
        const businessDescriptionEl = document.getElementById("businessDescription");
        if (walletAddressInput) walletAddressInput.value = "0x5728db90889ac3d5fd0a41286ca2480abcefe2a0";
        if (amountInput) amountInput.value = "$100 USD";
        if (businessDescriptionEl) businessDescriptionEl.value = "";

        window.dispatchEvent(new Event("loanRequestsUpdated"));
        // Cerrar modal inmediatamente y mostrar toast de éxito
            closeModalFunc();
        showToast("Se subió correctamente tu información");
      } catch (error) {
        console.error("Error en solicitud de préstamo:", error);
        alert(error.message || "Error desconocido");
      } finally {
        if (requestLoanBtn) {
          requestLoanBtn.disabled = false;
          requestLoanBtn.textContent = "Solicitar préstamo";
        }
      }
    });
  }
});

/*********************************************************
 * Modal Financiar Proyecto (fundRequest on-chain)       *
 *********************************************************/
document.addEventListener("DOMContentLoaded", () => {
  const modalFinanciar = $("#modalFinanciar");
  const closeModalFinanciar = $("#closeModalFinanciar");
  const proyectosLista = $("#proyectosLista");

  const getLoanProjects = () => {
    const cached = loadCachedLoanRequests();
    const map = new Map();

    cached.forEach((item, index) => {
      const key = item.borrower.toLowerCase();
      const baseUsd = item.amountUsd || LOAN_AMOUNT_USD_DEFAULT;
      const gainUsd = (baseUsd * INTEREST_PERCENT) / 100; // ganancia para el inversionista
      const gainUsdStr = `$${gainUsd.toFixed(2)} USD`;
      const baseUsdStr = `$${baseUsd.toFixed(2)} USD`;
      const totalUsd = baseUsd + gainUsd;
      const cuotaUsd = totalUsd / 2; // dos pagos iguales
      const cuotaUsdStr = `$${cuotaUsd.toFixed(2)} USD`;
      map.set(key, {
        id: `cached-${index}`,
        nombre: item.title || "Microemprendimiento de Benito Mendez",
        categoria: item.category || "",
        descripcion: item.reason || "Emprendimiento en proceso de evaluación.",
        // Mostrar tanto inversión como ganancia
        inversionUsd: baseUsdStr,
        gananciaUsd: gainUsdStr,
        cuotaUsdStr,
        montoFinanciado: item.status === "funded" ? "Fondeado" : "En espera",
        borrower: item.borrower,
        status: item.status,
        createdAt: item.createdAt,
        txHash: item.txHash,
        source: "cached",
        photoDataUrl: item.businessPhotoDataUrl || item.photoDataUrl || null,
        docs: item.docs || {}
      });
    });

    return Array.from(map.values());
  };

  const btnFinanciarMain = document.querySelector(".hero-buttons .btn-financiar");
  if (btnFinanciarMain && modalFinanciar) {
    btnFinanciarMain.addEventListener("click", () => {
            renderizarProyectos();
      modalFinanciar.classList.add("active");
        });
    }

    function closeModalFinanciarFunc() {
    modalFinanciar?.classList.remove("active");
  }
  if (closeModalFinanciar) closeModalFinanciar.addEventListener("click", closeModalFinanciarFunc);
    if (modalFinanciar) {
    modalFinanciar.addEventListener("click", (e) => {
      if (e.target === modalFinanciar) closeModalFinanciarFunc();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalFinanciar?.classList.contains("active")) closeModalFinanciarFunc();
  });

    function renderizarProyectos() {
        if (!proyectosLista) return;
    const proyectos = getLoanProjects();
    if (!proyectos.length) {
            proyectosLista.innerHTML = '<div class="proyecto-vacio">No hay proyectos disponibles en este momento</div>';
            return;
        }

    proyectosLista.innerHTML = proyectos
      .map((p) => {
            return `
                <div class="proyecto-card">
                    ${p.photoDataUrl ? `<div class=\"proyecto-cover\" style=\"margin-bottom:8px;\"><img src=\"${p.photoDataUrl}\" alt=\"Foto del negocio\" style=\"width:100%;height:140px;object-fit:cover;border-radius:10px;\"></div>` : ''}
                    <div class="proyecto-header">
                        <div>
                <h3 class="proyecto-nombre">${p.nombre}</h3>
                ${p.categoria ? `<span class=\"proyecto-categoria\">${p.categoria}</span>` : ''}
                        </div>
                    </div>
            <p class="proyecto-descripcion">${p.descripcion}</p>
                    <div class="proyecto-badges" style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 12px 0;">
                      ${p.docs?.scanId ? '<span class="badge" style="background:#eef;border:1px solid #cde;padding:4px 8px;border-radius:6px;font-size:12px;">ID escaneado</span>' : ''}
                      ${p.docs?.scanIdPadre ? '<span class="badge" style="background:#efe;border:1px solid #cde;padding:4px 8px;border-radius:6px;font-size:12px;">Ticket luz/renta</span>' : ''}
                      ${p.docs?.scanIdMadre ? '<span class="badge" style="background:#efe;border:1px solid #cde;padding:4px 8px;border-radius:6px;font-size:12px;">Tenencia/mercancía</span>' : ''}
                    </div>
                    <div class="proyecto-progress" style="margin-top:0;margin-bottom:8px;">
                      <div class="progress-label"><span>Confiabilidad</span><span>75%</span></div>
                      <div class="progress-bar"><div class="progress-fill" style="width:75%"></div></div>
                    </div>
                    <div class="interest-summary" style="display:flex;flex-direction:column;gap:6px;background:#f8fbff;border:1px solid #cfe4ff;padding:10px;border-radius:10px;margin-bottom:8px;">
                      <div style="display:flex;justify-content:space-between;font-size:13px;color:#555;">
                        <span>Plazos de pago</span>
                        <span>(15 y 30 días)</span>
                      </div>
                      <div style="display:flex;justify-content:space-between;font-size:13px;color:#2D3436;">
                        <span>Pago 1 (15 días)</span>
                        <span style="font-weight:700;">${p.cuotaUsdStr}</span>
                      </div>
                      <div style="display:flex;justify-content:space-between;font-size:13px;color:#2D3436;">
                        <span>Pago 2 (30 días)</span>
                        <span style="font-weight:700;">${p.cuotaUsdStr}</span>
                      </div>
                    </div>
                    <div class="proyecto-monto">
              <span class="monto-label">Wallet</span>
              <span class="monto-valor">
                <code>${p.borrower}</code>
              </span>
                    </div>
            <div class="proyecto-monto">
              <span class="monto-label">Inversión</span>
              <span class="monto-valor">${p.inversionUsd}</span>
                        </div>
            <div class="proyecto-monto">
              <span class="monto-label">Ganancia</span>
              <span class="monto-valor">${p.gananciaUsd}</span>
                        </div>
            <div class="proyecto-monto">
              <span class="monto-label">Estado</span>
              <span class="monto-valor">${p.montoFinanciado}</span>
                        </div>
            <button class="btn-financiar" data-proyecto-id="${p.id}" data-borrower="${p.borrower}" data-amount="${p.inversionUsd}" ${p.status === "funded" ? "disabled" : ""}>
              ${p.status === "funded" ? "Ya fondeado" : "Financiar este proyecto"}
                    </button>
                </div>
            `;
      })
      .join("");

    // Bind de botones "Financiar este proyecto"
    const botones = proyectosLista.querySelectorAll(".btn-financiar");
    botones.forEach((btn) => {
      btn.addEventListener("click", async function () {
        if (this.disabled) return;
        const proyectosActuales = getLoanProjects();
        const proyectoId = this.getAttribute("data-proyecto-id");
        const proyecto = proyectosActuales.find((x) => String(x.id) === String(proyectoId));
        if (!proyecto) return;

        if (!checkWalletConnection()) {
          try {
            await window.walletConnector.connect({ requireSignature: false });
          } catch {
            showToast("Conecta tu wallet para financiar.");
            $("#walletBtn")?.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
          }
        }

        // Usar automáticamente el borrower del proyecto (wallet fija)
        const borrower = proyecto.borrower || FIXED_BORROWER_ADDRESS;
        const lender = window.walletConnector.walletAddress; // Tu wallet conectada
        
        // Asegurar formato correcto del monto
        let amountEthStr = (this.getAttribute("data-amount") || proyecto.montoSolicitado || "0.0000001").toString();
        
        // IMPORTANTE: El contrato siempre requiere exactamente 0.0000001 ETH
        // Aunque se muestre $100 USD en la UI, usamos el monto fijo del contrato
        // Intentar obtener el monto real del proyecto primero
        let amountEth = proyecto.amountEth || CONTRACT_LOAN_AMOUNT_ETH;
        
        // Si no está en el proyecto, intentar extraer del string (por compatibilidad)
        if (!proyecto.amountEth) {
          // Intentar extraer de formato con paréntesis: "$100 USD (0.03333333 ETH)"
          const ethMatch = amountEthStr.match(/\(([\d.]+)\s*ETH\)/i);
          if (ethMatch) {
            // Ignorar el valor del paréntesis, usar el fijo del contrato
            amountEth = CONTRACT_LOAN_AMOUNT_ETH;
          } else {
            // Si no tiene paréntesis, intentar extraer solo el número antes de "ETH"
            const directMatch = amountEthStr.match(/([\d.]+)\s*ETH/i);
            if (directMatch) {
              // Verificar si es el valor correcto del contrato
              const extracted = directMatch[1];
              if (extracted === CONTRACT_LOAN_AMOUNT_ETH) {
                amountEth = extracted;
              } else {
                // Usar el valor fijo del contrato
                amountEth = CONTRACT_LOAN_AMOUNT_ETH;
              }
            } else {
              // Si no tiene "ETH", usar el valor fijo del contrato
              amountEth = CONTRACT_LOAN_AMOUNT_ETH;
            }
          }
        }
        
        // Asegurar que siempre usemos el valor correcto del contrato
        amountEth = CONTRACT_LOAN_AMOUNT_ETH;

        const ok = confirm(
          `¿Confirmar financiamiento?\n\nLender (tu wallet): ${lender}\nWallet: ${borrower}\nInversión: ${proyecto.inversionUsd}\nGanancia: ${proyecto.gananciaUsd}\n\nSe enviará el dinero desde tu wallet conectada a la wallet del proyecto.`
        );
        if (!ok) return;

        const originalText = this.textContent;
        this.disabled = true;
        this.textContent = "Procesando...";

        try {
          // Verificar que la wallet esté conectada
          if (!lender) {
            throw new Error("No se detectó la wallet conectada. Por favor, reconecta tu wallet.");
          }

          // Verificar formato de dirección del borrower
          if (!/^0x[a-fA-F0-9]{40}$/.test(borrower)) {
            throw new Error(`Dirección del borrower inválida: ${borrower}`);
          }

          const interaction = await preflightCheck();
          
          if (!interaction) {
            throw new Error("No se pudo inicializar la interacción con el contrato.");
          }

          this.textContent = "Enviando transacción...";
          const res = await interaction.fundRequest(borrower, amountEth);
          
          if (res.success && res.txHash) {
            alert("Transferencia exitosa");
            markLoanRequestFunded(borrower, res.txHash);
            renderizarProyectos();
          } else {
            throw new Error(res.error || "Error desconocido al financiar");
          }
        } catch (e) {
          console.error("Error en financiamiento:", e);
          const errorMsg = e.message || e.toString() || "Error desconocido";
          alert(`Error al financiar:\n\n${errorMsg}\n\nRevisa la consola para más detalles.`);
          this.disabled = false;
          this.textContent = originalText;
                }
            });
        });
    }

  window.addEventListener("loanRequestsUpdated", renderizarProyectos);
});

/******************************************************
 * Lecturas opcionales de estado on-chain a la UI     *
 ******************************************************/
async function readAllFor(addressOverride) {
  try {
    const interaction = await preflightCheck();
    const who = addressOverride || window.walletConnector.walletAddress;

    const [limit, paidConsecutive, isDef] = await Promise.all([
      interaction.contract.getLimit(who),
      interaction.contract.getLoansPaidConsecutive(who),
      interaction.contract.isDefaulted(who),
    ]);
    const [amount, approved, lender] = await interaction.contract.getLoanInfo(who);
    const [due1, due2] = await interaction.contract.getDueDates(who);
    const [paid1, paid2] = await interaction.contract.getPaidFlags(who);

    $("#out-limit") && ($("#out-limit").textContent = `${fmtEth(limit)} ETH`);
    $("#out-paidCons") && ($("#out-paidCons").textContent = paidConsecutive.toString());
    $("#out-isDef") && ($("#out-isDef").textContent = isDef ? "Sí" : "No");

    $("#out-amount") && ($("#out-amount").textContent = `${fmtEth(amount)} ETH`);
    $("#out-approved") && ($("#out-approved").textContent = approved ? "Sí" : "No");
    $("#out-lender") && ($("#out-lender").textContent = lender);

    const ts1 = Number(due1);
    const ts2 = Number(due2);
    $("#out-due1") && ($("#out-due1").textContent = ts1 ? new Date(ts1 * 1000).toLocaleString() : "-");
    $("#out-due2") && ($("#out-due2").textContent = ts2 ? new Date(ts2 * 1000).toLocaleString() : "-");
    $("#out-paid1") && ($("#out-paid1").textContent = paid1 ? "Sí" : "No");
    $("#out-paid2") && ($("#out-paid2").textContent = paid2 ? "Sí" : "No");
  } catch (e) {
    console.error("Error leyendo estado:", e);
    alert(e.message || "No se pudo leer el estado del préstamo");
  }
}

/******************************************************
 * Acciones rápidas (pago cuota / marcar default)     *
 ******************************************************/
async function payInstallmentQuick(amountEth) {
  try {
    const interaction = await preflightCheck();
    const res = await interaction.payInstallment(amountEth || "0");
    if (res.success) {
      alert(`Pago enviado. Ver transacción:\n${buildTxLink(res.txHash)}`);
    } else {
      alert(`Error al pagar: ${res.error}`);
    }
  } catch (e) {
    alert(e.message || "Error desconocido");
  }
}

// Nota: Botón DEMO 1-CLICK eliminado; su comportamiento vive en el flujo de "Financiar este proyecto" (autoconecta y financia)

async function markDefaultFor(borrowerAddr) {
  try {
    const interaction = await preflightCheck();
    const res = await interaction.checkAndMarkDefault(borrowerAddr);
    if (res.success) {
      alert(`Marcado como default. Ver transacción:\n${buildTxLink(res.txHash)}`);
    } else {
      alert(`Error al marcar: ${res.error}`);
    }
  } catch (e) {
    alert(e.message || "Error desconocido");
  }
}

/******************************************************
 * Exponer helpers a window (opcional para botones)   *
 ******************************************************/
window.appChain = {
  readAllFor,
  payInstallmentQuick,
  markDefaultFor,
};
