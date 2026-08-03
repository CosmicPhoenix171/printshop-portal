export type Material = 'PLA' | 'PETG';

export type OrderStatus =
  | 'Submitted'
  | 'Under review'
  | 'Waiting for customer'
  | 'Quoted'
  | 'Accepted'
  | 'Queued'
  | 'Printing'
  | 'Paused'
  | 'Failed'
  | 'Reprinting'
  | 'Post-processing'
  | 'Quality check'
  | 'Ready for pickup'
  | 'Ready to ship'
  | 'Shipped'
  | 'Completed'
  | 'Cancelled';

export type PaymentStatus =
  | 'Not charged'
  | 'Balance due'
  | 'Deposit paid'
  | 'Partially paid'
  | 'Paid in full'
  | 'Overpaid'
  | 'Refund due'
  | 'Refunded'
  | 'Waived'
  | 'Cancelled';

export type AvailabilityStatus =
  | 'Available'
  | 'Low stock'
  | 'Out of stock'
  | 'Special order'
  | 'Coming soon'
  | 'Hidden'
  | 'Discontinued';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  preferredContact?: 'Email' | 'Phone';
  shippingAddress?: string;
  pickupPreference?: boolean;
  accountStatus: 'Active' | 'Restricted' | 'Suspended' | 'Closed';
  createdAt: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  modelName: string;
  modelUrl: string;
  quantity: number;
  material: Material;
  colorId?: string;
  colorName: string;
  layerHeight: number;
  infillPercent: number;
  supportsAllowed: boolean;
  dimensions?: string;
  scale?: string;
  specialInstructions?: string;
  deliveryMethod: 'Local pickup' | 'Standard shipping' | 'Expedited shipping';
  requestedCompletionDate?: string;
  estimatedPrintHours?: number;
  estimatedFilamentGrams?: number;
  queuePosition?: number;
  queuedAt?: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  createdAt: number;
  updatedAt: number;
}

export interface Quote {
  id: string;
  orderId: string;
  estimatedFilamentGrams: number;
  estimatedPrintHours: number;
  materialCostCents: number;
  machineTimeCostCents: number;
  setupFeeCents: number;
  finishingFeeCents: number;
  shippingFeeCents: number;
  specialColorFeeCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  expiresAt?: number;
  customerNotes?: string;
  internalNotes?: string;
  status: 'Draft' | 'Sent' | 'Accepted' | 'Declined' | 'Expired' | 'Revised' | 'Cancelled';
  createdAt: number;
  updatedAt: number;
}

export interface BalanceTransaction {
  id: string;
  customerId: string;
  orderId?: string;
  type:
    | 'Order charge'
    | 'Additional charge'
    | 'Cash payment'
    | 'Card payment in person'
    | 'Check payment'
    | 'Deposit'
    | 'Discount'
    | 'Refund'
    | 'Customer credit'
    | 'Failed-print adjustment'
    | 'Cancellation adjustment'
    | 'Manual correction'
    | 'Transaction reversal';
  amountCents: number;
  description: string;
  paymentMethod?: 'Cash' | 'Card paid in person' | 'Check' | 'Other';
  adminId: string;
  createdAt: number;
  receiptNumber?: string;
  internalNote?: string;
}

export interface FinancialLedger {
  summary: {
    currentBalanceCents: number;
    updatedAt: number;
    signConvention?: 'credit-positive';
  };
  transactions?: Record<string, BalanceTransaction>;
}

export interface ColorOption {
  id: string;
  material: Material;
  name: string;
  hex: string;
  availabilityStatus: AvailabilityStatus;
  stockLabel: 'Plenty available' | 'Available' | 'Low stock' | 'Very low stock' | 'Out of stock' | 'Special order' | 'Coming soon';
  displayGrams?: number;
  priceDifferenceCents?: number;
  expectedRestockDate?: string;
  glowInTheDark?: boolean;
  metallic?: boolean;
  transparent?: boolean;
  twoTone?: boolean;
  selectable: boolean;
}

export interface InventorySettings {
  reservedWeightGrams: number;
  minimumReserveGrams: number;
  pricePerGramCents: number;
  wasteAllowancePercent: number;
  reorderThresholdGrams: number;
}

export interface FilamentSpool {
  id: string;
  material: Material;
  colorId: string;
  colorName: string;
  colorHex: string;
  startingWeightGrams: number;
  currentPhysicalWeightGrams: number;
  reservedWeightGrams: number;
  minimumReserveGrams: number;
  pricePerGramCents: number;
  wasteAllowancePercent: number;
  purchaseDate?: string;
  expectedRestockDate?: string;
  reorderThresholdGrams: number;
  usesCustomInventorySettings?: boolean;
  availabilityStatus: AvailabilityStatus;
  glowInTheDark?: boolean;
  metallic?: boolean;
  transparent?: boolean;
  twoTone?: boolean;
  notes?: string;
  updatedAt: number;
}

export interface ColorRequest {
  id: string;
  customerId: string;
  customerName: string;
  material: Material;
  requestedColorName: string;
  colorHex?: string;
  referenceImageUrl?: string;
  preferredBrand?: string;
  associatedOrderId?: string;
  approximateAmountGrams?: number;
  requestedCompletionDate?: string;
  similarColorsAccepted: boolean;
  willingToWait: boolean;
  willingToPaySpecialOrderFee: boolean;
  willingToPayForFullSpool: boolean;
  notes?: string;
  status:
    | 'Submitted'
    | 'Reviewing'
    | 'Waiting for customer'
    | 'Approved'
    | 'Declined'
    | 'Alternative suggested'
    | 'Waiting for payment'
    | 'Payment confirmed'
    | 'Ordered'
    | 'Arrived'
    | 'Added to inventory'
    | 'Customer notified'
    | 'Completed'
    | 'Cancelled';
  createdAt: number;
  updatedAt: number;
}

export interface AppNotification {
  id: string;
  customerId: string;
  title: string;
  message: string;
  orderId?: string;
  createdAt: number;
  read: boolean;
}

export interface SharedImage {
  id: string;
  title: string;
  description?: string;
  fileName: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  imageData: string;
  isShared: boolean;
  uploadedBy: string;
  createdAt: number;
  updatedAt: number;
  sharedAt?: number;
}


export interface Printer {
  id: string;
  name: string;
  model: string;
  buildWidthMm: number;
  buildDepthMm: number;
  buildHeightMm: number;
  supportedMaterials: Material[];
  nozzleSizeMm: number;
  status: 'Available' | 'Printing' | 'Paused' | 'Maintenance' | 'Offline' | 'Error';
  currentOrderId?: string;
  lastMaintenanceDate?: string;
  nextMaintenanceDate?: string;
  notes?: string;
  updatedAt: number;
}

export interface PrintQueueItem {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  modelName: string;
  material: Material;
  colorName: string;
  quantity: number;
  estimatedPrintHours: number;
  estimatedFilamentGrams: number;
  printerId?: string;
  printerName?: string;
  queuePosition: number;
  priority: 'Low' | 'Normal' | 'High' | 'Urgent';
  deadline?: string;
  paymentStatus: PaymentStatus;
  status: 'Queued' | 'Preparing' | 'Printing' | 'Paused' | 'Failed' | 'Completed' | 'Cancelled';
  createdAt: number;
  updatedAt: number;
}
