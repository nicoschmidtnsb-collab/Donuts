const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const db = new Database(process.env.DB_PATH || './pedidos.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS pedidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    email TEXT NOT NULL,
    direccion TEXT NOT NULL,
    comuna TEXT NOT NULL,
    cantidad INTEGER NOT NULL,
    unidades INTEGER NOT NULL,
    total INTEGER NOT NULL,
    fecha_despacho TEXT NOT NULL,
    mp_preference_id TEXT,
    mp_payment_id TEXT,
    estado TEXT DEFAULT 'pendiente',
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

const COMUNAS_PERMITIDAS = ['lo barnechea', 'vitacura', 'las condes'];

function detectarComuna(direccion) {
  const d = direccion.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (d.includes('lo barnechea')) return 'Lo Barnechea';
  if (d.includes('vitacura')) return 'Vitacura';
  if (d.includes('las condes')) return 'Las Condes';
  return null;
}

function pedidosAbiertos() {
  const ahora = new Date();
  const dia = ahora.getDay();
  const hora = ahora.getHours() + ahora.getMinutes() / 60;
  if (dia === 4 && hora < 15) return false;
  if (dia === 3 && hora >= 21) return false;
  return true;
}

function proximoJueves() {
  const ahora = new Date();
  const dia = ahora.getDay();
  const hora = ahora.getHours() + ahora.getMinutes() / 60;
  let diff = (4 - dia + 7) % 7;
  if (dia === 4 && hora < 15) diff = 7;
  if (dia === 3 && hora >= 21) diff = (4 - dia + 7) % 7;
  if (diff === 0) diff = 7;
  const jueves = new Date(ahora);
  jueves.setDate(ahora.getDate() + diff);
  jueves.setHours(0, 0, 0, 0);
  return jueves;
}

async function enviarConfirmacion({ nombre, email, cantidad, fecha_despacho, direccion, comuna, total }) {
  const unidades = cantidad * 75;
  await transporter.sendMail({
    from: `"Donuts 🍩" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: '¡Tu pedido está confirmado! 🍩',
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:auto;padding:24px;color:#2d1a0e">
        <h2 style="color:#e8612a">¡Hola ${nombre}! 🍩</h2>
        <p style="color:#666;margin:8px 0 24px">Tu pedido fue confirmado:</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:8px 0;color:#999;border-bottom:1px solid #f0e8e0">Producto</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #f0e8e0">Caja de Donuts x${cantidad} (${unidades} unidades)</td></tr>
          <tr><td style="padding:8px 0;color:#999;border-bottom:1px solid #f0e8e0">Despacho</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #f0e8e0">${fecha_despacho}</td></tr>
          <tr><td style="padding:8px 0;color:#999;border-bottom:1px solid #f0e8e0">Dirección</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #f0e8e0">${direccion}, ${comuna}</td></tr>
          <tr><td style="padding:10px 0;font-weight:bold">Total pagado</td><td style="padding:10px 0;text-align:right;font-weight:bold;color:#e8612a">$${Number(total).toLocaleString('es-CL')} CLP</td></tr>
        </table>
        <p style="margin-top:24px;font-size:13px;color:#999">¿Dudas? Responde este correo.</p>
      </div>`,
  });
  await transporter.sendMail({
    from: `"Donuts Checkout" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_NEGOCIO || process.env.EMAIL_USER,
    subject: `Nuevo pedido de ${nombre} – ${fecha_despacho}`,
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:auto;padding:24px;color:#2d1a0e">
        <h2 style="color:#e8612a">Nuevo pedido 🍩</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:8px 0;color:#999;border-bottom:1px solid #f0e8e0">Cliente</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #f0e8e0">${nombre}</td></tr>
          <tr><td style="padding:8px 0;color:#999;border-bottom:1px solid #f0e8e0">Email</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #f0e8e0">${email}</td></tr>
          <tr><td style="padding:8px 0;color:#999;border-bottom:1px solid #f0e8e0">Cajas</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #f0e8e0">${cantidad} (${unidades} donuts)</td></tr>
          <tr><td style="padding:8px 0;color:#999;border-bottom:1px solid #f0e8e0">Despacho</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #f0e8e0">${fecha_despacho}</td></tr>
          <tr><td style="padding:8px 0;color:#999;border-bottom:1px solid #f0e8e0">Dirección</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #f0e8e0">${direccion}, ${comuna}</td></tr>
          <tr><td style="padding:10px 0;font-weight:bold">Total</td><td style="padding:10px 0;text-align:right;font-weight:bold;color:#e8612a">$${Number(total).toLocaleString('es-CL')} CLP</td></tr>
        </table>
      </div>`,
  });
}

app.get('/api/estado', (req, res) => {
  const abierto = pedidosAbiertos();
  const jueves = proximoJueves();
  res.json({
    abierto,
    proximo_jueves: jueves.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    mensaje: abierto ? null : 'Los pedidos están cerrados. Reabre el jueves a las 15:00 hrs.',
  });
});

app.post('/api/validar-direccion', (req, res) => {
  const { direccion } = req.body;
  const comuna = detectarComuna(direccion || '');
  if (!comuna) {
    return res.json({ valida: false, mensaje: 'Solo despachamos a Lo Barnechea, Vitacura y Las Condes. Incluye tu comuna en la dirección.' });
  }
  res.json({ valida: true, comuna });
});

app.post('/crear-preferencia', async (req, res) => {
  if (!pedidosAbiertos()) {
    return res.status(400).json({ error: 'Los pedidos están cerrados. Reabre el jueves a las 15:00 hrs.' });
  }
  const { nombre, email, cantidad, fecha_despacho, direccion } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es requerido' });
  if (!email?.includes('@')) return res.status(400).json({ error: 'Email inválido' });
  if (!cantidad || cantidad < 1) return res.status(400).json({ error: 'Cantidad inválida' });
  if (!fecha_despacho) return res.status(400).json({ error: 'Fecha de despacho requerida' });
  if (!direccion?.trim()) return res.status(400).json({ error: 'La dirección es requerida' });

  const comuna = detectarComuna(direccion);
  if (!comuna) return res.status(400).json({ error: 'Solo despachamos a Lo Barnechea, Vitacura y Las Condes.' });

  const total = cantidad * 30000;
  try {
    const preference = await new Preference(client).create({
      body: {
        payer: { name: nombre, email },
        items: [{ id: 'caja-donuts-75', title: 'Caja de Donuts (75 unidades)', description: `${cantidad} caja${cantidad > 1 ? 's' : ''} · Despacho ${fecha_despacho}`, quantity: cantidad, unit_price: 30000, currency_id: 'CLP' }],
        metadata: { nombre, email, fecha_despacho, direccion, comuna, total_unidades: cantidad * 75, total_pago: total },
        back_urls: {
          success: `${process.env.BASE_URL || 'http://localhost:3000'}/gracias`,
          failure: `${process.env.BASE_URL || 'http://localhost:3000'}/error`,
          pending: `${process.env.BASE_URL || 'http://localhost:3000'}/pendiente`,
        },
        auto_return: 'approved',
        statement_descriptor: 'Donuts',
        notification_url: `${process.env.BASE_URL || 'http://localhost:3000'}/webhook`,
      },
    });
    db.prepare(`INSERT INTO pedidos (nombre, email, direccion, comuna, cantidad, unidades, total, fecha_despacho, mp_preference_id, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente')`)
      .run(nombre, email, direccion, comuna, cantidad, cantidad * 75, total, fecha_despacho, preference.id);
    res.json({ init_point: preference.init_point, sandbox_init_point: preference.sandbox_init_point });
  } catch (error) {
    console.error('Error MP:', error);
    res.status(500).json({ error: 'Error al crear preferencia de pago' });
  }
});

app.post('/webhook', async (req, res) => {
  const { type, data } = req.body;
  if (type === 'payment' && data?.id) {
    try {
      const payment = await new Payment(client).get({ id: data.id });
      if (payment.status === 'approved') {
        const meta = payment.metadata || {};
        db.prepare(`UPDATE pedidos SET estado='pagado', mp_payment_id=? WHERE mp_preference_id=?`)
          .run(String(data.id), payment.preference_id);
        await enviarConfirmacion({
          nombre: meta.nombre || 'Cliente',
          email: meta.email || payment.payer?.email,
          cantidad: payment.additional_info?.items?.[0]?.quantity || 1,
          fecha_despacho: meta.fecha_despacho || '—',
          direccion: meta.direccion || '—',
          comuna: meta.comuna || '—',
          total: meta.total_pago || payment.transaction_amount,
        });
      }
    } catch (err) { console.error('Webhook error:', err.message); }
  }
  res.sendStatus(200);
});

app.get('/repartidor', (req, res) => {
  const pass = req.query.pass;
  if (pass !== process.env.PANEL_PASSWORD) {
    return res.status(401).send(`
      <html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9f5f0">
        <div style="text-align:center;padding:40px;background:#fff;border-radius:16px;border:0.5px solid #e0d8d0;max-width:320px;width:90%">
          <div style="font-size:40px;margin-bottom:16px">🍩</div>
          <h2 style="color:#2d1a0e;margin-bottom:20px;font-size:18px">Panel del Repartidor</h2>
          <form method="GET" action="/repartidor">
            <input name="pass" type="password" placeholder="Contraseña" style="width:100%;padding:10px;border:0.5px solid #ccc;border-radius:8px;font-size:14px;margin-bottom:12px;box-sizing:border-box">
            <button type="submit" style="width:100%;padding:10px;background:#2d1a0e;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer">Entrar</button>
          </form>
        </div>
      </body></html>`);
  }

  const jueves = proximoJueves().toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' });
  const pedidos = db.prepare(`SELECT * FROM pedidos WHERE estado='pagado' ORDER BY comuna, nombre`).all();
  const comunas = ['Lo Barnechea', 'Vitacura', 'Las Condes'];
  const porComuna = {};
  comunas.forEach(c => { porComuna[c] = []; });
  pedidos.forEach(p => { if (!porComuna[p.comuna]) porComuna[p.comuna] = []; porComuna[p.comuna].push(p); });
  const totalCajas = pedidos.reduce((a, p) => a + p.cantidad, 0);
  const totalDonuts = pedidos.reduce((a, p) => a + p.unidades, 0);

  const filasComuna = Object.entries(porComuna).map(([comuna, ps]) => {
    if (ps.length === 0) return `<div style="margin-bottom:24px"><h3 style="color:#9a7060;font-size:15px;margin-bottom:8px">${comuna} <span style="font-weight:400;color:#ccc">(sin pedidos)</span></h3></div>`;
    const filas = ps.map(p => `
      <tr style="border-bottom:0.5px solid #f0e8e0">
        <td style="padding:12px 8px;font-weight:500">${p.nombre}</td>
        <td style="padding:12px 8px;color:#666">${p.direccion}</td>
        <td style="padding:12px 8px;text-align:center">${p.cantidad} caja${p.cantidad>1?'s':''}</td>
        <td style="padding:12px 8px;text-align:center;color:#9a7060">${p.unidades}</td>
        <td style="padding:12px 8px;font-size:12px;color:#999">${p.email}</td>
      </tr>`).join('');
    return `
      <div style="margin-bottom:28px">
        <h3 style="color:#2d1a0e;font-size:15px;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #e8612a">${comuna} — ${ps.length} pedido${ps.length>1?'s':''}</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#fff5ef">
            <th style="padding:8px;text-align:left;color:#9a7060;font-weight:500">Nombre</th>
            <th style="padding:8px;text-align:left;color:#9a7060;font-weight:500">Dirección</th>
            <th style="padding:8px;text-align:center;color:#9a7060;font-weight:500">Cajas</th>
            <th style="padding:8px;text-align:center;color:#9a7060;font-weight:500">Donuts</th>
            <th style="padding:8px;text-align:left;color:#9a7060;font-weight:500">Email</th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>`;
  }).join('');

  res.send(`
    <html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Panel Repartidor – Donuts</title>
    <style>body{font-family:sans-serif;background:#f9f5f0;color:#2d1a0e;margin:0}
    .header{background:#2d1a0e;color:#fff;padding:16px 24px;display:flex;align-items:center;gap:12px}
    .container{max-width:900px;margin:0 auto;padding:24px 16px}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:28px}
    .stat{background:#fff;border-radius:12px;padding:16px;text-align:center;border:0.5px solid #e0d8d0}
    .stat-num{font-size:28px;font-weight:600;color:#e8612a}
    .stat-label{font-size:12px;color:#9a7060;margin-top:4px}
    @media print{.no-print{display:none}}</style></head>
    <body>
    <div class="header">
      <span style="font-size:24px">🍩</span>
      <div><div style="font-weight:600;font-size:16px">Panel del Repartidor</div>
      <div style="font-size:12px;opacity:0.7">Despacho: jueves ${jueves}</div></div>
      <button onclick="window.print()" class="no-print" style="margin-left:auto;padding:8px 16px;background:#e8612a;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px">🖨️ Imprimir</button>
    </div>
    <div class="container">
      <div class="stats">
        <div class="stat"><div class="stat-num">${pedidos.length}</div><div class="stat-label">Pedidos</div></div>
        <div class="stat"><div class="stat-num">${totalCajas}</div><div class="stat-label">Cajas totales</div></div>
        <div class="stat"><div class="stat-num">${totalDonuts}</div><div class="stat-label">Donuts totales</div></div>
      </div>
      ${filasComuna}
      ${pedidos.length===0?'<p style="text-align:center;color:#9a7060;padding:40px">No hay pedidos pagados aún.</p>':''}
    </div></body></html>`);
});

app.get('/gracias', (req, res) => res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;color:#2d1a0e"><h1 style="font-size:48px">🍩</h1><h2>¡Pago exitoso!</h2><p style="color:#9a7060">Revisa tu correo — te enviamos la confirmación.</p><a href="/" style="display:inline-block;margin-top:24px;padding:12px 24px;background:#e8612a;color:#fff;border-radius:10px;text-decoration:none">Hacer otro pedido</a></body></html>`));
app.get('/error', (req, res) => res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>❌ Hubo un problema con el pago</h2><a href="/" style="display:inline-block;margin-top:24px;padding:12px 24px;background:#2d1a0e;color:#fff;border-radius:10px;text-decoration:none">Intentar de nuevo</a></body></html>`));
app.get('/pendiente', (req, res) => res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>⏳ Pago pendiente</h2><p style="color:#9a7060">Te avisaremos por email cuando se confirme.</p></body></html>`));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor en http://localhost:${PORT}`));
