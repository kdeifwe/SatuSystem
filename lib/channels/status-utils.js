function normalizeConnectionStatus(value) {
  if (value === 'qr' || value === 'connected' || value === 'disconnected' || value === 'error') {
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
