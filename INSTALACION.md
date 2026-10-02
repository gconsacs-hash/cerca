# Cerca — la familia conectada

App tipo SoyMomo, pero hecha para los celulares que ya tienen: ubicación de todos en
un mapa, lugares seguros con aviso de llegada y salida, botón SOS y chat familiar.

Funciona en Android y iPhone (es una app web instalable). No necesita tienda de apps,
no necesita cuenta, no necesita pagar nada.

---

## 1. Lo primero: hay que publicarla

La ubicación del celular **solo funciona en direcciones `https://`**. Mientras la app
esté únicamente en este PC, sirve para mirarla, no para usarla en los teléfonos.

Para dejarla andando en los celulares:

```
clic derecho en publicar.ps1  →  Ejecutar con PowerShell
```

Queda en `https://gconsacs-hash.github.io/cerca/`. El script se puede correr todas las
veces que quieras: la primera crea el sitio, las siguientes solo actualizan.

**¿Y la privacidad?** La dirección es pública, pero quien la abra sin el código de
ustedes no ve absolutamente nada de la familia: solo la pantalla de bienvenida.
Lo que protege es el **código de 6 caracteres**.

---

## 2. Vincular los celulares

**En tu celular (el primero):**
1. Abrir la dirección en Chrome → menú ⋮ → **Instalar app** (así queda con su icono).
2. **Crear mi familia** → nombre de la familia → tu nombre → rol **Adulto**.
3. Aparece el **código de 6 caracteres** (ejemplo: `K7M2PQ`).
4. **Compartir por WhatsApp** manda el enlace con el código adentro.

**En el celular de tu esposa y en los de los niños:**
1. Abrir el enlace que llegó por WhatsApp (ya trae el código escrito).
2. **Unirme con un código** → Continuar.
3. Nombre, **rol** (Adulto para tu esposa, Hijo para los niños), figura y color.
4. Cuando Chrome pregunte por la ubicación: **Permitir siempre** (no "solo esta vez").
5. Menú ⋮ → **Instalar app**.

Listo: en el mapa aparecen todos.

---

## 3. Qué hace cada cosa

| Pantalla | Para qué |
|---|---|
| 🗺️ **Mapa** | Dónde está cada uno, hace cuánto se supo y con cuánta batería. Las tarjetas de abajo centran el mapa en esa persona. |
| 📍 **Lugares** | Casa, colegio, trabajo. Cuando alguien entra o sale, queda el aviso en el chat. |
| 💬 **Chat** | Mensajes de la familia. El botón ✅ avisa "llegué bien" con la ubicación. |
| 👤 **Yo** | Tu perfil, cada cuánto envías tu posición, los avisos y el código de la familia. |

**Botón SOS** (rojo, en el mapa): se mantiene presionado **3 segundos** para que no
se dispare sin querer. Al soltarlo antes, no pasa nada. Cuando se envía, a los demás
les suena el aviso, les vibra el teléfono y les aparece una barra roja con **Ver**
(abre el mapa en el punto exacto) y **Voy** (avisa al resto que alguien va en camino).

**Botones del mapa:** 🎯 centra en ti · 👪 encuadra a toda la familia ·
☕ mantiene la pantalla encendida (útil en un viaje, para que la posición no se corte).

---

## 4. Quién ve a quién

- Los **adultos** ven a todos.
- Los **hijos** ven solo a los adultos (no se ven entre hermanos).
- Arriba hay **siempre** un aviso de que la ubicación se está compartiendo. Es a
  propósito: los niños tienen que saber que están compartiendo, no descubrirlo.
- Un **adulto** puede pausar su ubicación; cuando lo hace, al resto le llega el aviso
  de que la pausó. Un **hijo** no puede pausarla.

Un detalle honesto: esa jerarquía la aplica la app, no la nube. Quien tenga el código
de la familia y sepa de programación podría leer todos los datos del espacio familiar.
Para el uso real (la familia) alcanza; no es un sistema contra un adversario técnico.

---

## 5. Dónde viven los datos

En tu proyecto Firebase **rumbo-3ba8c** (el mismo de Rumbo y del Semáforo, plan
gratuito), en el espacio `spaces/fam-<CÓDIGO>/docs`. No se mezcla con las otras apps.

Las reglas de Firestore que ya tienes sirven tal cual:

```
match /spaces/{space}/docs/{doc} {
  allow read, write: if request.auth != null;
}
```

Si prefieres un proyecto aparte: Firebase → Authentication → habilitar **Anónimo** →
Firestore → crear → pegar esas reglas → copiar el bloque `firebaseConfig` y pegarlo en
**Yo → Avanzado → Usar otro proyecto Firebase**.

El chat se recorta solo: se guardan los últimos 120 mensajes.

---

## 6. Lo que esta app **no** hace

Vale la pena tenerlo claro antes de confiarse:

- **No reporta ubicación con la app cerrada.** Una app web no puede. Mientras esté
  abierta (aunque sea de fondo, con el celular en el bolsillo) va informando; si el
  teléfono la cierra para ahorrar batería, la última posición queda congelada y los
  demás ven "hace 20 min". Por eso el mapa siempre muestra *hace cuánto* se supo.
- **No bloquea aplicaciones ni limita el tiempo de pantalla.** Eso necesita una app
  nativa de Android instalada en cada teléfono.
- **No avisa con el celular apagado o sin internet.**

Si en algún momento quieres seguimiento de verdad en segundo plano, el camino es un
acompañante nativo en Android (como AURA) que reporte a este mismo Firebase: la app
web seguiría sirviendo para ver el mapa, y el teléfono de los niños informaría solo.

---

## 7. Probar y revisar

```
node pruebas.js                 27 pruebas de la lógica (distancias, geocercas, privacidad, códigos)
node pruebas/servidor-e2e.js    luego abrir http://localhost:3461/pruebas/e2e.html
                                27 pasos de extremo a extremo contra Firestore real:
                                simula dos celulares, mapa, lugares, chat, SOS y limpia todo al salir
Iniciar.cmd                     abre la app en este PC (http://localhost:3410)
```

En el PC no hay GPS, así que el mapa se ve sin tu posición: es normal.

---

## 8. Archivos

```
index.html              pantallas y estilos
app.js                  toda la lógica (estado, nube, mapa, geocercas, SOS, chat)
sw.js                   service worker: la app abre aunque no haya señal
manifest.webmanifest    para instalarla como app
vendor/                 Leaflet guardado localmente (si el CDN falla, el mapa igual abre)
servidor.js             servidor local de prueba
publicar.ps1            sube la app a GitHub Pages
pruebas.js              pruebas de lógica
pruebas/                prueba de extremo a extremo con navegador real
```
