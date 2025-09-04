const { Kafka } = require('kafkajs');
const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const clientId = process.env.KAFKA_CLIENT_ID || 'abr-client';
const kafka = new Kafka({ clientId, brokers });

const producer = kafka.producer();

function getProducer() {
return producer;
}


function getConsumer(groupId) {
return kafka.consumer({ groupId });
}

const connectProducer = async () => {
  try {
    await producer.connect(); // safe to call multiple times
    console.log("✅ Kafka Producer connected");
  } catch (err) {
    console.error("❌ Kafka Producer connection error:", err);
  }
};

module.exports = { getProducer, getConsumer,connectProducer };