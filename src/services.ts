import {
  get,
  push,
  ref,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';
import { db } from './firebase';
import type {
  BalanceTransaction,
  ColorRequest,
  FilamentSpool,
  Material,
  Order,
  OrderStatus,
  PaymentStatus,
  Quote,
  UserProfile,
} from './types';
import { safeExternalUrl } from './utils';

const BOOTSTRAP_ADMIN_UID = '7OcGG2CZbTcluReuQzBn7QPJ8Hm1';

export async function checkAdmin(uid: string): Promise<boolean> {
  if (uid === BOOTSTRAP_ADMIN_UID) return true;
  const snapshot = await get(ref(db, `admins/${uid}`));
  return snapshot.val() === true;
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  await set(ref(db, `userProfiles/${profile.uid}`), profile);
}

export async function createOrder(
  customer: UserProfile,
  values: Omit<Order, 'id' | 'orderNumber' | 'customerId' | 'customerName' | 'status' | 'paymentStatus' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const orderRef = push(ref(db, 'orders'));
  if (!orderRef.key) throw new Error('Could not create an order ID.');

  const now = Date.now();
  const order: Order = {
    ...values,
    modelUrl: safeExternalUrl(values.modelUrl),
    id: orderRef.key,
    orderNumber: `P-${now.toString().slice(-8)}`,
    customerId: customer.uid,
    customerName: customer.displayName,
    status: 'Submitted',
    paymentStatus: 'Not charged',
    createdAt: now,
    updatedAt: now,
  };

  await update(ref(db), {
    [`orders/${order.id}`]: order,
    [`ordersByUser/${customer.uid}/${order.id}`]: true,
  });

  return order.id;
}

export async function createColorRequest(
  request: Omit<ColorRequest, 'id' | 'status' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const requestRef = push(ref(db, 'colorRequests'));
  if (!requestRef.key) throw new Error('Could not create a color request ID.');
  const now = Date.now();
  const record: ColorRequest = {
    ...request,
    id: requestRef.key,
    status: 'Submitted',
    createdAt: now,
    updatedAt: now,
  };
  await set(requestRef, record);
  return record.id;
}

export async function setQuoteDecision(orderId: string, uid: string, decision: 'Accepted' | 'Declined') {
  await set(ref(db, `quoteDecisions/${orderId}/${uid}`), {
    decision,
    decidedAt: Date.now(),
  });
}

export async function sendOrderMessage(orderId: string, senderId: string, senderRole: 'Customer' | 'Administrator', message: string) {
  const messageRef = push(ref(db, `orderMessages/${orderId}`));
  if (!messageRef.key) throw new Error('Could not create message.');
  await set(messageRef, {
    id: messageRef.key,
    senderId,
    senderRole,
    message: message.trim(),
    createdAt: Date.now(),
  });
}

export async function markNotificationRead(uid: string, notificationId: string) {
  await set(ref(db, `notifications/${uid}/${notificationId}/read`), true);
}

export async function adminUpdateOrderStatus(
  order: Order,
  status: OrderStatus,
  paymentStatus: PaymentStatus,
  adminId: string,
  note = '',
) {
  const historyRef = push(ref(db, `orderStatusHistory/${order.id}`));
  if (!historyRef.key) throw new Error('Could not create history entry.');
  const now = Date.now();
  await update(ref(db), {
    [`orders/${order.id}/status`]: status,
    [`orders/${order.id}/paymentStatus`]: paymentStatus,
    [`orders/${order.id}/updatedAt`]: now,
    [`orderStatusHistory/${order.id}/${historyRef.key}`]: {
      id: historyRef.key,
      previousStatus: order.status,
      newStatus: status,
      previousPaymentStatus: order.paymentStatus,
      newPaymentStatus: paymentStatus,
      changedAt: now,
      changedBy: adminId,
      customerVisibleNote: note,
    },
    [`adminAuditLogs/${historyRef.key}`]: {
      id: historyRef.key,
      administratorId: adminId,
      actionType: 'Order status changed',
      targetId: order.id,
      customerId: order.customerId,
      orderId: order.id,
      previousValue: order.status,
      newValue: status,
      reason: note,
      createdAt: now,
    },
  });
}

export async function adminSaveQuote(order: Order, quote: Omit<Quote, 'id' | 'orderId' | 'createdAt' | 'updatedAt'>, adminId: string) {
  const quoteId = 'current';
  const now = Date.now();
  const record: Quote = {
    ...quote,
    id: quoteId,
    orderId: order.id,
    createdAt: now,
    updatedAt: now,
  };
  await update(ref(db), {
    [`quotes/${order.id}/${quoteId}`]: record,
    [`orders/${order.id}/status`]: 'Quoted',
    [`orders/${order.id}/updatedAt`]: now,
    [`adminAuditLogs/quote-${order.id}-${now}`]: {
      id: `quote-${order.id}-${now}`,
      administratorId: adminId,
      actionType: 'Quote saved',
      targetId: quoteId,
      customerId: order.customerId,
      orderId: order.id,
      newValue: record.totalCents,
      createdAt: now,
    },
  });
}

export async function adminRecordBalanceTransaction(
  customerId: string,
  transaction: Omit<BalanceTransaction, 'id' | 'customerId' | 'createdAt'>,
) {
  const ledgerRef = ref(db, `financialLedgers/${customerId}`);
  const transactionId = push(ref(db, `financialLedgers/${customerId}/transactions`)).key;
  if (!transactionId) throw new Error('Could not create transaction ID.');
  const now = Date.now();

  await runTransaction(ledgerRef, (ledger) => {
    const current = ledger ?? { summary: { currentBalanceCents: 0, updatedAt: now }, transactions: {} };
    current.summary = {
      currentBalanceCents: Number(current.summary?.currentBalanceCents ?? 0) + transaction.amountCents,
      updatedAt: now,
    };
    current.transactions = current.transactions ?? {};
    current.transactions[transactionId] = {
      ...transaction,
      id: transactionId,
      customerId,
      createdAt: now,
    };
    return current;
  });

  await set(ref(db, `adminAuditLogs/${transactionId}`), {
    id: transactionId,
    administratorId: transaction.adminId,
    actionType: 'Balance transaction recorded',
    targetId: transactionId,
    customerId,
    orderId: transaction.orderId ?? null,
    newValue: transaction.amountCents,
    reason: transaction.description,
    createdAt: now,
  });
}

export async function adminSaveSpool(spool: FilamentSpool) {
  await set(ref(db, `filamentSpools/${spool.id}`), spool);

  const snapshot = await get(ref(db, 'filamentSpools'));
  const allSpools = snapshot.exists() ? Object.values(snapshot.val() as Record<string, FilamentSpool>) : [];
  const matching = allSpools.filter(
    (item) => item.material === spool.material && item.colorId === spool.colorId,
  );
  const available = matching.reduce(
    (sum, item) => sum + Math.max(
      0,
      item.currentPhysicalWeightGrams - item.reservedWeightGrams - item.minimumReserveGrams,
    ),
    0,
  );

  let stockLabel: 'Plenty available' | 'Available' | 'Low stock' | 'Very low stock' | 'Out of stock' | 'Special order' | 'Coming soon';
  if (spool.availabilityStatus === 'Special order') stockLabel = 'Special order';
  else if (spool.availabilityStatus === 'Coming soon') stockLabel = 'Coming soon';
  else if (available > 750) stockLabel = 'Plenty available';
  else if (available > 300) stockLabel = 'Available';
  else if (available > 150) stockLabel = 'Low stock';
  else if (available > 0) stockLabel = 'Very low stock';
  else stockLabel = 'Out of stock';

  const selectable = available > 0 && !['Hidden', 'Discontinued', 'Out of stock'].includes(spool.availabilityStatus);
  const publicColor = {
    id: spool.colorId,
    colorId: spool.colorId,
    name: spool.colorName,
    colorName: spool.colorName,
    hex: spool.colorHex,
    colorHex: spool.colorHex,
    material: spool.material,
    displayGrams: available,
    availableGrams: available,
    availabilityStatus: spool.availabilityStatus,
    stockLabel,
    selectable,
    updatedAt: Date.now(),
  };

  await update(ref(db), {
    [`publicInventory/${spool.material}/${spool.colorId}`]: publicColor,
    [`colors/${spool.material}/${spool.colorId}`]: publicColor,
  });
}

export async function adminCreateColor(material: Material, name: string, hex: string) {
  const colorRef = push(ref(db, `colors/${material}`));
  if (!colorRef.key) throw new Error('Could not create color ID.');
  await set(colorRef, {
    id: colorRef.key,
    material,
    name,
    hex,
    availabilityStatus: 'Coming soon',
    stockLabel: 'Coming soon',
    selectable: false,
    createdAt: serverTimestamp(),
  });
}


export async function subscribeToRestock(uid: string, material: Material, colorId: string) {
  await set(ref(db, `restockRequests/${material}/${colorId}/${uid}`), {
    customerId: uid,
    material,
    colorId,
    requestedAt: Date.now(),
    active: true,
    notificationStatus: 'Waiting',
  });
}
