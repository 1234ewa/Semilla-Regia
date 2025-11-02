### Semilla Regia

Semilla Regia es una plataforma digital que impulsa el crecimiento de microempresas mediante préstamos descentralizados. Conecta a emprendedores que necesitan financiamiento con inversionistas que buscan apoyar proyectos reales, utilizando tecnología blockchain para garantizar transparencia, seguridad y beneficios en tokens.

### ¿Cómo correr el sitio?

Requisitos mínimos:
- Navegador de escritorio (Chrome/Brave/Firefox).
- Extensión de wallet web3 (recomendado: MetaMask) instalada y desbloqueada.
- Estar en la red correcta indicada por la configuración del contrato (ver `principal/js/config.js`).

Opciones para levantarla en local:

1) Servidor HTTP simple (recomendado)

```bash
cd "SEMILLA (2)"
python3 -m http.server 8080
# Abre en tu navegador:
# http://localhost:8080/principal/principal.html
```

Alternativas con Node.js (sin instalación global):

```bash
# Opción A: http-server
npx http-server -p 8080
# Opción B: serve
npx serve -l 8080 .
# Luego abre:
# http://localhost:8080/principal/principal.html
```

2) Abrir el archivo directamente (menos recomendado)
- Abre `principal/principal.html` en el navegador. Si la wallet no se inyecta correctamente, usa la opción del servidor local (1).

### Configuración
- Revisa `principal/js/config.js` para confirmar dirección del contrato, red y/o endpoints RPC.
- Asegúrate de seleccionar la misma red en tu wallet antes de interactuar.

### Despliegue (GitHub Pages)
- En GitHub: Settings → Pages → Source: `main` (root).
- La URL quedará como: `https://<tu-usuario>.github.io/Semilla-Regia/principal/principal.html`.

### Solución de problemas
- La wallet no se conecta: verifica que estás en la red correcta y actualiza la página.
- Error al leer proveedor: sirve la app con un servidor local (python/http-server) en lugar de abrir el archivo directamente.


### Contratos en Arbitrum Stylus
- La dApp utiliza dos contratos desplegados en Arbitrum Stylus:
  - Contrato de pagos: gestiona los flujos de pago y liquidaciones entre inversionistas y emprendedores.
  - Contrato de almacenamiento: registra y referencia los metadatos/archivos asociados a solicitudes y estados de los préstamos.
- Las direcciones de los contratos y la red se configuran en `principal/js/config.js`.

#### Estructura de carpetas de contratos
```
contratos/
  pagos/
    src/
      lib.rs        # lógica de pagos (placeholder)
  archivos/
    src/
      lib(1).rs     # lógica de almacenamiento (placeholder)
```
Nota: se incluye `.gitattributes` para asegurar que GitHub compute Rust en el porcentaje de lenguajes.


