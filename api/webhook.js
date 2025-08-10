// pages/api/webhook.js
import mercadopago from 'mercadopago';
import admin from 'firebase-admin';

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

mercadopago.configurations.setAccessToken(process.env.MERCADOPAGO_ACCESS_TOKEN);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const { topic, id } = req.body;

    if (topic === 'payment') {
      const response = await mercadopago.payment.get(id);
      const payment = response.body;

      const status = payment.status;
      const externalReference = payment.external_reference;

      if (!externalReference) {
        return res.status(400).send('Missing external_reference');
      }

      const orderRef = db.collection('orders').doc(externalReference);

      await orderRef.update({
        status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`Pedido ${externalReference} atualizado para status: ${status}`);

      return res.status(200).send('OK');
    }

    return res.status(200).send('Event ignored');
  } catch (error) {
    console.error(error);
    return res.status(500).send('Internal Server Error');
  }
}
