// pages/api/webhook/mercadopago.js
import mercadopago from 'mercadopago';
import admin from 'firebase-admin';

if (!admin.apps.length) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : require('../../../serviceAccountKey.json'); // Use só se tiver o arquivo no repo
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN,
});


function mapStatus(mpStatus) {
  const s = (mpStatus || '').toLowerCase();
  if (s === 'approved' || s === 'authorized') return 'completed';
  if (s === 'pending' || s === 'in_process' || s === 'in_mediation') return 'pending';
  if (s === 'rejected' || s === 'cancelled' || s === 'refunded') return 'cancelled';
  return s;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    // Modo simulação para testes
    if (req.query.simulate === '1' || req.headers['x-simulate'] === '1') {
      const orderId = req.body.orderId || req.body.external_reference || req.body.payment?.external_reference;
      const statusRaw = req.body.status || req.body.payment?.status;
      if (!orderId || !statusRaw)
        return res.status(400).json({ error: 'orderId e status são obrigatórios no modo simulate' });

      await db.collection('orders').doc(String(orderId)).update({
        status: mapStatus(statusRaw),
        rawPaymentStatus: statusRaw,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`[simulate] Pedido ${orderId} -> ${statusRaw}`);
      return res.status(200).send('OK (simulate)');
    }

    // Obtém o paymentId do webhook
    const paymentId =
      req.body?.data?.id ||
      req.query['data.id'] ||
      req.body?.id ||
      req.query?.id ||
      (req.body?.topic === 'payment' && req.body?.id) ||
      null;

    if (!paymentId) {
      console.error('paymentId não encontrado no webhook', { body: req.body, query: req.query });
      return res.status(400).send('payment id not found');
    }

    // Busca pagamento no Mercado Pago
    const mpResp = await mercadopago.payment.findById(paymentId);
    const payment = mpResp.body;
    const statusRaw = payment.status;
    const externalRef = payment.external_reference;
    const prefId = payment.preference_id || payment.preference?.id;

    // Atualiza Firestore pelo external_reference
    if (externalRef) {
      await db.collection('orders').doc(String(externalRef)).update({
        status: mapStatus(statusRaw),
        rawPaymentStatus: statusRaw,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log(`Pedido ${externalRef} atualizado para ${statusRaw}`);
      return res.status(200).send('OK');
    }

    // Se não tiver external_reference, tenta pelo preferenceId
    if (prefId) {
      const q = await db.collection('orders').where('preferenceId', '==', String(prefId)).limit(1).get();
      if (!q.empty) {
        const doc = q.docs[0];
        await doc.ref.update({
          status: mapStatus(statusRaw),
          rawPaymentStatus: statusRaw,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`Pedido ${doc.id} atualizado via preferenceId para ${statusRaw}`);
        return res.status(200).send('OK');
      }
    }

    console.warn('external_reference e preferenceId não encontrados no pagamento:', paymentId);
    return res.status(400).send('order not found');
  } catch (error) {
    console.error('Erro no webhook:', error);
    return res.status(500).send('Erro no webhook');
  }
}
