// backend/index.js
const express = require('express');
const mercadopago = require('mercadopago');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json'); // Ajuste o nome do arquivo aqui

// Inicializa Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const app = express();
app.use(express.json());

// Configura token de acesso Mercado Pago
mercadopago.configurations.setAccessToken('APP_USR-7971682693642996-080622-632be381cc1a1bc60fce1bbbd0ab75c9-2581054508');

app.post('/api/webhook/mercadopago', async (req, res) => {
  try {
    const { topic, id } = req.body;

    if (topic === 'payment') {
      const response = await mercadopago.payment.get(id);
      const payment = response.body;
      const status = payment.status; // ex: approved, pending, cancelled
      const externalReference = payment.external_reference; // ID do pedido no Firestore

      if (!externalReference) {
        console.warn('external_reference não encontrado no pagamento:', id);
        return res.status(400).send('external_reference missing');
      }

      // Atualiza status do pedido no Firestore
      const orderRef = db.collection('orders').doc(externalReference);
      await orderRef.update({
        status: status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`Pedido ${externalReference} atualizado para status: ${status}`);
      return res.status(200).send('OK');
    }

    // Outros tópicos podem ser ignorados
    return res.status(200).send('Evento ignorado');
  } catch (error) {
    console.error('Erro no webhook:', error);
    return res.status(500).send('Erro interno');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
