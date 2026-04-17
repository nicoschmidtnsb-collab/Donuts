const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
require('dotenv').config();
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ── Mercado Pago ──────────────────────────────────────────────
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

// ── Nodemailer (Gmail) ────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // App Password de Google
  },
});

async function enviarConfirmacion({ nombre, email, cantidad, fecha_despacho, direccion, total }) {
  const unidades = cantidad * 75;

  // Email al comprador
  await transporter.sendMail({
    from: `"Donuts 🍩" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: '¡Tu pedido está confirmado! 🍩',
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:auto;padding:24px;color:#2d1a0e">
        <h2 style="font-family:Georgia,serif;color:#e8612a">¡Hola ${nombre}! 🍩</h2>
        <p style="color:#666;margin:8px 0 24px">Tu pedido fue confirmado. Aquí está el resumen:</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:8px 0;color:#999;border-bottom:1px solid #f0e8e0">Producto</td>
              <td style="padding:8px 0;text-align:right;border-bottom:1px solid #f0e8e0">Caja de Donuts x${cantidad}</td></tr>
          <tr><td style="padding:8px 0;color:#999;border-bottom:1px solid #f0e8e0">Unidades</td>
              <td style="padding:8px 0;text-align:right;border-bottom:1px solid #f0e8e0">${unidades} donuts</td></tr>
          <tr><td style="padding:8px 0;color:#999;border-bottom:1px solid #f0e8e0">Despacho</td>
              <td style="padding:8px 0;text-align:right;border-bottom:1px solid #f0e8e0">${fecha_despacho}</td></tr>
          <tr><td style="padding:8px 0;color:#999;border-bottom:1px solid #f0e8e0">Dirección</td>
              <td style="padding:8px 0;text-align:right;border-bottom:1px solid #f0e8e0">${direccion}</td></tr>
          <tr><td style="padding:10px 0;font-weight:bold">Total pagado</td>
              <td style="padding:10px 0;text-align:right;font-weight:bold;color:#e8612a">$${Number(total).toLocaleString('es-CL')} CLP</td></tr>
        </table>
        <p style="margin-top:24px;font-size:13px;color:#999">¿Dudas? Responde este correo y te ayudamos.</p>
      </div>
    `,
  });

  // Email al negocio
  await transporter.sendMail({
    from: `"Donuts Checkout" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_NEGOCIO || process.env.EMAIL_USER,
    subject: `Nuevo pedido de ${nombre} – ${fecha_despacho}`,
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:auto;padding:24px;color:#2d1a0e">
        <h2 style="color:#e8612a">Nuevo pedido 🍩</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:8px 0;color:#999;border-bottom:1px solid #f0e8e0">Cliente</td>
              <td style="padding:8px 0;text-align:right;border-bottom:1px solid #f0e8e0">${nombre}</td></tr>
          <tr><td style="padding:8px 0;color:#999;border-bottom:1px solid #f0e8e0">Email</td>
              <td style="padding:8px 0;text-align:right;border-bottom:1px solid #f0e8e0">${email}</td></tr>
          <tr><td style="padding:8px 0;color:#999;border-bottom:1px solid #f0e8e0">Cajas</td>
              <td style="padding:8px 0;text-align:right;border-bottom:1px solid #f0e8e0">${cantidad} (${unidades} donuts)</td></tr>
          <tr><td style="padding:8px 0;color:#999;border-bottom:1px solid #f0e8e0">Despacho</td>
              <td style="padding:8px 0;text-align:right;border-bottom:1px solid #f0e8e0">${fecha_despacho}</td></tr>
          <tr><td style="padding:8px 0;color:#999;border-bottom:1px solid #f0e8e0">Dirección</td>
              <td style="padding:8px 0;text-align:right;border-bottom:1px solid #f0e8e0">${direccion}</td></tr>
          <tr><td style="padding:10px 0;font-weight:bold">Total</td>
              <td style="padding:10px 0;text-align:right;font-weight:bold;color:#e8612a">$${Number(total).toLocaleString('es-CL')} CLP</td></tr>
        </table>
      </div>
    `,
  });
}

// ── Crear preferencia de pago ─────────────────────────────────
app.post('/crear-preferencia', async (req, res) => {
  const { nombre, email, cantidad, fecha_despacho, direccion } = req.body;

  if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es requerido' });
  if (!email?.includes('@')) return res.status(400).json({ error: 'Email inválido' });
  if (!cantidad || cantidad < 1) return res.status(400).json({ error: 'Cantidad inválida' });
  if (!fecha_despacho) return res.status(400).json({ error: 'Fecha de despacho requerida' });
  if (!direccion?.trim()) return res.status(400).json({ error: 'La dirección es requerida' });

  try {
    const preference = await new Preference(client).create({
      body: {
        payer: { name: nombre, email },
        items: [{
          id: 'caja-donuts-75',
          title: 'Caja de Donuts (75 unidades)',
          description: `${cantidad} caja${cantidad > 1 ? 's' : ''} · Despacho el ${fecha_despacho}`,
          quantity: cantidad,
          unit_price: 30000,
          currency_id: 'CLP',
        }],
        metadata: { nombre, email, fecha_despacho, direccion, total_unidades: cantidad * 75, total_pago: cantidad * 30000 },
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

    res.json({ init_point: preference.init_point, sandbox_init_point: preference.sandbox_init_point, id: preference.id });
  } catch (error) {
    console.error('Error Mercado Pago:', error);
    res.status(500).json({ error: 'Error al crear preferencia de pago' });
  }
});

// ── Webhook ───────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const { type, data } = req.body;
  if (type === 'payment' && data?.id) {
    try {
      const payment = await new Payment(client).get({ id: data.id });
      if (payment.status === 'approved') {
        const meta = payment.metadata || {};
        await enviarConfirmacion({
          nombre:         meta.nombre         || 'Cliente',
          email:          meta.email          || payment.payer?.email,
          cantidad:       payment.additional_info?.items?.[0]?.quantity || 1,
          fecha_despacho: meta.fecha_despacho || '—',
          direccion:      meta.direccion      || '—',
          total:          meta.total_pago     || payment.transaction_amount,
        });
        console.log(`✅ Email enviado a ${meta.email}`);
      }
    } catch (err) {
      console.error('Error webhook:', err.message);
    }
  }
  res.sendStatus(200);
});

// ── Páginas de retorno ────────────────────────────────────────
app.get('/gracias', (req, res) => {
  res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;color:#2d1a0e">
    <h1 style="font-size:48px">🍩</h1><h2>¡Pago exitoso!</h2>
    <p style="color:#9a7060">Revisa tu correo — te enviamos la confirmación con los detalles del despacho.</p>
    <a href="/" style="display:inline-block;margin-top:24px;padding:12px 24px;background:#e8612a;color:#fff;border-radius:10px;text-decoration:none">Hacer otro pedido</a>
  </body></html>`);
});
app.get('/error', (req, res) => {
  res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px">
    <h2>❌ Hubo un problema con el pago</h2>
    <a href="/" style="display:inline-block;margin-top:24px;padding:12px 24px;background:#2d1a0e;color:#fff;border-radius:10px;text-decoration:none">Intentar de nuevo</a>
  </body></html>`);
});
app.get('/pendiente', (req, res) => {
  res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px">
    <h2>⏳ Pago pendiente</h2><p style="color:#9a7060">Te avisaremos por email cuando se confirme.</p>
  </body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor en http://localhost:${PORT}`));
