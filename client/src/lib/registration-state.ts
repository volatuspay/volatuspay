let _pendingSellerRegistration = false;

export function markSellerRegistrationPending() {
  _pendingSellerRegistration = true;
}

export function clearSellerRegistrationPending() {
  _pendingSellerRegistration = false;
}

export function isSellerRegistrationPending() {
  return _pendingSellerRegistration;
}
