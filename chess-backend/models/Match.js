const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const matchSchema = new Schema({
  roomId: String,
  white: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  black: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  result: { type: String, enum: ['1-0', '0-1', '1/2-1/2'], required: true },
  playedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Match', matchSchema);
