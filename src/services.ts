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
  InventorySettings,
  Material,
  Order,
  OrderStatus,
  PaymentStatus,
  Quote,
  SharedImage,
  UserProfile,
} from './types';
import { safeExternalUrl } from './utils';

const BOOTSTRAP_ADMIN_UID = '7OcGG2CZbTcluReuQzBn7QPJ8Hm1';
const MAX_IMAGE_BYTES = 750 * 1024;
const ALLOWED_IMAGE_TYPES: SharedImage['mimeType'][] = ['image/jpeg', 'image/png', 'image/webp'];

export async function imageFileToBase64(file: File): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type as SharedImage['mimeType'])) {
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('Image must be 750 KB or smaller.');
  }

  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });
}

export async function adminUploadImage(
  values: Pick<SharedImage, 'title' | 'description' | 'fileName' | 'mimeType' | 'imageData'>,
  adminId: string,
  shareNow: boolean,
): Promise<void> {
  const imageRef = push(ref(db, 'adminImages'));
  if (!imageRef.key) throw new Error('Could not create an image ID.');
  const now = Date.now();
  const image: SharedImage = {
    ...values,
    id: imageRef.key,
    isShared: shareNow,
    uploadedBy: adminId,
    createdAt: now,
    updatedAt: now,
    ...(shareNow ? { sharedAt: now } : {}),
  };
  await update(ref(db), {
    [`adminImages/${image.id}`]: image,
    [`sharedImages/${image.id}`]: shareNow ? image : null,
  });
}

export async function adminSetImageShared(image: SharedImage, isShared: boolean): Promise<void> {
  const now = Date.now();
  const updated: SharedImage = {
    ...image,
    isShared,
    updatedAt: now,
    ...(isShared ? { sharedAt: now } : {}),
  };
  if (!isShared) delete updated.sharedAt;
  await update(ref(db), {
    [`adminImages/${image.id}`]: updated,
    [`sharedImages/${image.id}`]: isShared ? updated : null,
  });
}

export async function adminDeleteImage(imageId: string): Promise<void> {
  await update(ref(db), {
    [`adminImages/${imageId}`]: null,
    [`sharedImages/${imageId}`]: null,
  });
}

export async function checkAdmin(uid: string): Promise<boolean> {
  const adminRef = ref(db, `admins/${uid}`);
  if (uid === BOOTSTRAP_ADMIN_UID) {
    await set(adminRef, true);
    return true;
  }
  const snapshot = await get(adminRef);
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
    const current = ledger ?? { summary: { currentBalanceCents: 0, updatedAt: now, signConvention: 'credit-positive' }, transactions: {} };
    if (current.summary?.signConvention !== 'credit-positive') {
      current.summary.currentBalanceCents = -Number(current.summary?.currentBalanceCents ?? 0);
      for (const existingTransaction of Object.values(current.transactions ?? {}) as Array<{ amountCents?: number }>) {
        existingTransaction.amountCents = -Number(existingTransaction.amountCents ?? 0);
      }
    }
    current.summary = {
      currentBalanceCents: Number(current.summary?.currentBalanceCents ?? 0) + transaction.amountCents,
      updatedAt: now,
      signConvention: 'credit-positive',
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
  const spoolRef = ref(db, `filamentSpools/${spool.id}`);
  const previousSnapshot = await get(spoolRef);
  const previous = previousSnapshot.exists() ? (previousSnapshot.val() as FilamentSpool) : null;
  const { brand: _brand, storageLocation: _storageLocation, supplier: _supplier, ...cleanSpool } = spool as FilamentSpool & {
    brand?: string;
    storageLocation?: string;
    supplier?: string;
  };
  await set(spoolRef, cleanSpool);

  const snapshot = await get(ref(db, 'filamentSpools'));
  const allSpools = snapshot.exists() ? Object.values(snapshot.val() as Record<string, FilamentSpool>) : [];
  const groups = [spool];
  if (previous && (previous.material !== spool.material || previous.colorId !== spool.colorId)) groups.push(previous);
  const updates: Record<string, unknown> = {};

  for (const group of groups) {
    const matching = allSpools.filter(
      (item) => item.material === group.material && item.colorId === group.colorId,
    );
    if (matching.length === 0) {
      updates[`publicInventory/${group.material}/${group.colorId}`] = null;
      updates[`colors/${group.material}/${group.colorId}`] = null;
      continue;
    }

    const representative = matching.find((item) => item.id === spool.id) ?? matching[0];
    const available = matching.reduce(
      (sum, item) => sum + Math.max(
        0,
        item.currentPhysicalWeightGrams - item.reservedWeightGrams - item.minimumReserveGrams,
      ),
      0,
    );
    let stockLabel: 'Plenty available' | 'Available' | 'Low stock' | 'Very low stock' | 'Out of stock' | 'Special order' | 'Coming soon';
    if (representative.availabilityStatus === 'Special order') stockLabel = 'Special order';
    else if (representative.availabilityStatus === 'Coming soon') stockLabel = 'Coming soon';
    else if (available > 750) stockLabel = 'Plenty available';
    else if (available > 300) stockLabel = 'Available';
    else if (available > 150) stockLabel = 'Low stock';
    else if (available > 0) stockLabel = 'Very low stock';
    else stockLabel = 'Out of stock';

    const publicColor = {
      id: representative.colorId,
      colorId: representative.colorId,
      name: representative.colorName,
      colorName: representative.colorName,
      hex: representative.colorHex,
      colorHex: representative.colorHex,
      material: representative.material,
      displayGrams: available,
      availableGrams: available,
      pricePerGramCents: representative.pricePerGramCents,
      wasteAllowancePercent: representative.wasteAllowancePercent,
      availabilityStatus: representative.availabilityStatus,
      glowInTheDark: matching.some((item) => item.glowInTheDark === true),
      metallic: matching.some((item) => item.metallic === true),
      transparent: matching.some((item) => item.transparent === true),
      twoTone: matching.some((item) => item.twoTone === true),
      secondaryColorName: representative.secondaryColorName ?? null,
      secondaryColorHex: representative.secondaryColorHex ?? null,
      stockLabel,
      selectable: available > 0 && !['Hidden', 'Discontinued', 'Out of stock'].includes(representative.availabilityStatus),
      updatedAt: Date.now(),
    };
    updates[`publicInventory/${group.material}/${group.colorId}`] = publicColor;
    updates[`colors/${group.material}/${group.colorId}`] = publicColor;
  }

  await update(ref(db), updates);
}

export async function adminDeleteSpool(spool: FilamentSpool) {
  await set(ref(db, `filamentSpools/${spool.id}`), null);

  const snapshot = await get(ref(db, 'filamentSpools'));
  const allSpools = snapshot.exists() ? Object.values(snapshot.val() as Record<string, FilamentSpool>) : [];
  const remaining = allSpools.find(
    (item) => item.material === spool.material && item.colorId === spool.colorId,
  );

  if (remaining) {
    await adminSaveSpool(remaining);
    return;
  }

  await update(ref(db), {
    [`publicInventory/${spool.material}/${spool.colorId}`]: null,
    [`colors/${spool.material}/${spool.colorId}`]: null,
  });
}

export async function adminSaveInventoryDefaults(material: Material, settings: InventorySettings, forceAll = false) {
  await set(ref(db, `businessSettings/private/inventoryDefaults/${material}`), settings);
  const snapshot = await get(ref(db, 'filamentSpools'));
  const spools = snapshot.exists() ? Object.values(snapshot.val() as Record<string, FilamentSpool>) : [];

  for (const spool of spools) {
    if (spool.material !== material || (!forceAll && spool.usesCustomInventorySettings === true)) continue;
    await adminSaveSpool({
      ...spool,
      ...settings,
      usesCustomInventorySettings: false,
      updatedAt: Date.now(),
    });
  }
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
