// pages/api/payment/create.js
import mercadopago from 'mercadopago';
import admin from 'firebase-admin';

if (!admin.apps.length) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : require('../../serviceAccountKey.json'); // só se você tiver o arquivo no repo
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

mercadopago.configurations.setAccessToken(process.env.MP_ACCESS_TOKEN);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { orderId, items } = req.body;
    if (!orderId || !Array.isArray(items)) return res.status(400).json({ error: 'orderId e items são obrigatórios' });

    const preference = {
      items: items.map(it => ({
        title: it.title,
        quantity: Number(it.quantity),
        unit_price: Number(it.unit_price),
        currency_id: 'BRL'
      })),
      external_reference: orderId,
      notification_url: `${process.env.BASE_URL}/api/webhook/mercadopago`,
      back_urls: {
        success: `${process.env.BASE_URL}/meus-pedidos?status=success`,
        failure: `${process.env.BASE_URL}/meus-pedidos?status=failure`,
        pending: `${process.env.BASE_URL}/meus-pedidos?status=pending`
      },
      auto_return: 'approved'
    };

    const response = await mercadopago.preferences.create(preference);
    const pref = response.body;
    const init_point = pref.init_point || pref.sandbox_init_point || null;
    const preferenceId = pref.id || null;

    // Atualiza o pedido no Firestore com preferenceId e link
    await db.collection('orders').doc(orderId).update({
      preferenceId,
      paymentLink: init_point,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json({ init_point, preferenceId });
  } catch (error) {
    console.error('Erro criar preferência:', error);
    return res.status(500).json({ error: 'Erro ao criar preferência de pagamento' });
  }
}
