function normalizeConnectionStatus(value) {
  if (value === 'qr' || value === 'connected' || value === 'disconnected' || value === 'error' || value === 'challenge' || value === '2fa') {
    return value;
  }

  return 'disconnected';
}

function buildChannelStatusUpdate(connectionStatus, isActive) {
  return {
    is_active: Boolean(isActive),
    connection_status: normalizeConnectionStatus(connectionStatus),
  };
}

module.exports = {
  normalizeConnectionStatus,
  buildChannelStatusUpdate,
};
