# Integración del Contrato Inteligente - SEMILLA REGÍA

## 📋 Información del Contrato

- **Dirección del Contrato**: `0x13eCeFcaD68A8689E53c8A448A2C9Da38cADBC40`
- **Red**: Arbitrum Sepolia (Chain ID: 421614)
- **Explorador**: [Arbiscan Sepolia](https://sepolia.arbiscan.io/address/0x13eCeFcaD68A8689E53c8A448A2C9Da38cADBC40)

## 🔧 Archivos Creados/Modificados

### Archivos Nuevos
1. **`defi-interface/js/contract-config.js`**
   - Configuración del contrato (dirección, ABI, chain ID)
   - Configuración de red

2. **`defi-interface/js/contract-interaction.js`**
   - Clase `ContractInteraction` para interactuar con el contrato
   - Métodos para todas las funciones del contrato
   - Manejo de red y transacciones

### Archivos Modificados
1. **`defi-interface/js/wallet-connect.js`**
   - Integración con ethers.js
   - Inicialización automática del contrato al conectar wallet
   - Verificación de red

2. **`principal/js/main.js`**
   - Formulario de préstamo conectado con `requestLoan()`
   - Modal de financiar conectado con `fundRequest()`
   - Manejo de transacciones y errores

3. **`principal/principal.html`**
   - Scripts de ethers.js y módulos del contrato agregados

4. **`defi-interface/dashboard.html`**
   - Scripts de blockchain agregados
   - ID del botón de wallet corregido

## 🚀 Funcionalidades Implementadas

### 1. Conexión de Wallet
- Conexión automática con MetaMask
- Verificación y cambio a red Arbitrum Sepolia
- Persistencia de conexión en localStorage

### 2. Solicitar Préstamo (`requestLoan`)
- Al completar el formulario, se llama a `requestLoan()` del contrato
- Validación de wallet conectada
- Confirmación de transacción con link a Arbiscan

### 3. Financiar Proyecto (`fundRequest`)
- Ingreso de dirección del prestatario
- Ingreso de monto en ETH
- Confirmación de transacción
- Link a transacción en blockchain

### 4. Funciones de Consulta (Preparadas)
Las siguientes funciones están disponibles en `ContractInteraction`:
- `getLoanInfo(address)` - Información del préstamo
- `getDueDates(address)` - Fechas de vencimiento
- `getPaidFlags(address)` - Estado de pagos
- `getLimit(address)` - Límite de crédito
- `getLoansPaidConsecutive(address)` - Préstamos pagados consecutivamente
- `isDefaulted(address)` - Verificar si está en default

## 📝 Instrucciones de Uso

### Para Usuarios

1. **Conectar Wallet**
   - Haz clic en "Conectar wallet"
   - Acepta la conexión en MetaMask
   - La aplicación cambiará automáticamente a Arbitrum Sepolia si es necesario

2. **Solicitar Préstamo**
   - Completa el formulario con tus datos
   - Haz clic en "Enviar Solicitud"
   - Confirma la transacción en MetaMask
   - Espera la confirmación de la transacción

3. **Financiar Proyecto**
   - Selecciona un proyecto disponible
   - Ingresa la dirección del prestatario
   - Ingresa el monto en ETH
   - Confirma la transacción

### Para Desarrolladores

#### Cambiar a Arbitrum One (Mainnet)

Si quieres cambiar a Arbitrum One, edita `contract-config.js`:

```javascript
chainId: 42161, // Arbitrum One
networkName: 'Arbitrum One'
```

Y actualiza las URLs del explorador en `contract-interaction.js` y `main.js`.

#### Agregar Nuevas Funciones

Para agregar funciones adicionales del contrato:

1. Agrega la función al ABI en `contract-config.js`
2. Agrega el método en `contract-interaction.js`:

```javascript
async nuevaFuncion(parametros) {
    try {
        await this.checkNetwork();
        const tx = await this.contract.nuevaFuncion(parametros);
        const receipt = await tx.wait();
        return { success: true, txHash: receipt.hash };
    } catch (error) {
        return { success: false, error: error.message };
    }
}
```

## ⚠️ Notas Importantes

1. **Red**: El contrato está configurado para Arbitrum Sepolia. Asegúrate de tener ETH de prueba en esta red.

2. **Gas Fees**: Todas las transacciones requieren pagar gas fees en ETH de la red correspondiente.

3. **Inicialización**: La función `initializeUser()` se llama automáticamente la primera vez que un usuario conecta su wallet.

4. **Validación**: El formulario de préstamo aún guarda datos locales. Para producción, considera:
   - Enviar datos del formulario a un backend
   - Guardar solo la transacción de blockchain
   - Validar datos antes de llamar al contrato

## 🔍 Verificación de Transacciones

Todas las transacciones exitosas incluyen un link al explorador de blockchain:
- Arbitrum Sepolia: `https://sepolia.arbiscan.io/tx/{txHash}`
- Arbitrum One: `https://arbiscan.io/tx/{txHash}`

## 🐛 Solución de Problemas

### MetaMask no se conecta
- Verifica que MetaMask esté instalado
- Recarga la página
- Verifica los permisos del sitio

### Error de red
- Verifica que estés conectado a Arbitrum Sepolia
- La app intentará cambiar de red automáticamente

### Transacción falla
- Verifica que tengas suficiente ETH para gas
- Verifica los parámetros de la transacción
- Revisa la consola del navegador para más detalles

## 📚 Recursos

- [Ethers.js Documentación](https://docs.ethers.io/v5/)
- [Arbitrum Documentación](https://docs.arbitrum.io/)
- [MetaMask Documentación](https://docs.metamask.io/)

