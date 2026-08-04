import { get, push, ref, set, update } from 'firebase/database';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Loading } from '../components/Loading';
import { StatusBadge } from '../components/StatusBadge';
import { db } from '../firebase';
import { useRealtimeQuery, useRealtimeValue } from '../hooks/useRealtime';
import {
  cancelCustomerOrder,
  createColorRequest,
  createOrder,
  deleteAdminNotification,
  deleteAllAdminNotifications,
  deleteAllNotifications,
  deleteNotification,
  markAdminNotificationRead,
  markNotificationRead,
  adminUpdateOrderStatus,
  saveProfile,
  sendOrderMessage,
  setQuoteDecision,
  subscribeToRestock,
  updateCustomerOrder,
} from '../services';
import type {
  AppNotification,
  ColorOption,
  ColorRequest,
  FinancialLedger,
  Material,
  Order,
  Quote,
  SharedImage,
  UserProfile,
} from '../types';
import { formatDate, formatMoney, getTierRateCents, normalizedBalanceCents, objectValues } from '../utils';

const detailOrderStatuses: Order['status'][] = ['Submitted', 'Under review', 'Waiting for customer', 'Quoted', 'Accepted', 'Queued', 'Printing', 'Paused', 'Failed', 'Reprinting', 'Post-processing', 'Quality check', 'Ready for pickup', 'Ready to ship', 'Shipped', 'Completed', 'Cancelled'];
const detailPaymentStatuses: Order['paymentStatus'][] = ['Not charged', 'Balance due', 'Deposit paid', 'Partially paid', 'Paid in full', 'Overpaid', 'Refund due', 'Refunded', 'Waived', 'Cancelled'];

export function CustomerDashboard() {
  const { user, profile } = useAuth();
  const { data: orderMap } = useRealtimeQuery<Record<string, Order>>(user ? 'orders' : null, 'customerId', user?.uid ?? '');
  const { data: ledger } = useRealtimeValue<FinancialLedger>(user ? `financialLedgers/${user.uid}` : null);
  const orders = objectValues(orderMap).filter((order) => order.customerId === user?.uid);
  const active = orders.filter((order) => !['Completed', 'Cancelled'].includes(order.status));

  return (
    <Page title={`Welcome, ${profile?.displayName ?? 'customer'}`} intro="Submit prints, follow progress, and see your in-person payment balance.">
      <div className="stat-grid">
        <Stat label="Active orders" value={String(active.length)} />
        <Stat label="Total orders" value={String(orders.length)} />
        <Stat label="Current balance" value={formatMoney(normalizedBalanceCents(ledger?.summary))} />
      </div>
      <section className="panel">
        <div className="panel-heading"><h2>Recent orders</h2><Link className="button" to="/orders/new">New print request</Link></div>
        <OrderTable orders={orders.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5)} />
      </section>
    </Page>
  );
}

export function NewOrderPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { data: plaColors } = useRealtimeValue<Record<string, ColorOption>>('colors/PLA');
  const { data: petgColors } = useRealtimeValue<Record<string, ColorOption>>('colors/PETG');
  const [material, setMaterial] = useState<Material>('PLA');
  const [selectedColorId, setSelectedColorId] = useState('');
  const [multiColor, setMultiColor] = useState(false);
  const [selectedColorIds, setSelectedColorIds] = useState<string[]>([]);
  const [estimatedFilamentGrams, setEstimatedFilamentGrams] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const colors = objectValues(material === 'PLA' ? plaColors : petgColors).filter((color) => color.selectable);
  const selectedColor = colors.find((color) => color.id === selectedColorId);
  const selectedColors = multiColor ? colors.filter((color) => selectedColorIds.includes(color.id)) : selectedColor ? [selectedColor] : [];
  const averageTierRate = selectedColors.length ? selectedColors.reduce((sum, color) => sum + getTierRateCents(material, estimatedFilamentGrams, color), 0) / selectedColors.length : 0;
  const estimatedMaterialCostCents = selectedColors.length
    ? Math.round(estimatedFilamentGrams * averageTierRate)
    : 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    if (multiColor && selectedColors.length < 2) {
      setError('Select at least two colors for multi-color printing.');
      return;
    }
    if (!multiColor && colors.length > 0 && !selectedColor) {
      setError('Select an available color.');
      return;
    }
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const id = await createOrder(profile, {
        modelName: String(form.get('modelName')),
        modelUrl: String(form.get('modelUrl')),
        quantity: Number(form.get('quantity')),
        material,
        colorId: selectedColors[0]?.id ?? '',
        colorName: selectedColors.map((color) => color.name).join(' + ') || 'Color requested separately',
        multiColor,
        selectedColors: selectedColors.map((color) => ({ id: color.id, name: color.name })),
        layerHeight: Number(form.get('layerHeight')),
        infillPercent: Number(form.get('infillPercent')),
        supportsAllowed: form.get('supportsAllowed') === 'on',
        dimensions: String(form.get('dimensions') || ''),
        scale: String(form.get('scale') || ''),
        specialInstructions: String(form.get('specialInstructions') || ''),
        deliveryMethod: String(form.get('deliveryMethod')) as Order['deliveryMethod'],
        requestedCompletionDate: String(form.get('requestedCompletionDate') || ''),
        estimatedFilamentGrams,
        estimatedMaterialCostCents,
      });
      navigate(`/orders/${id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to submit order.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="New print request" intro="Provide a downloadable model link. Payment is collected and recorded in person.">
      <form className="panel form-grid" onSubmit={submit}>
        <label>Model name<input name="modelName" required maxLength={120} /></label>
        <label>Model link<input name="modelUrl" type="url" required placeholder="https://" /></label>
        <div className="model-source-links field-full" aria-label="Find a printable model">
          <span>Find a model</span>
          <a href="https://www.printables.com/" target="_blank" rel="noreferrer">Printables</a>
          <a href="https://www.thingiverse.com/" target="_blank" rel="noreferrer">Thingiverse</a>
          <a href="https://makerworld.com/" target="_blank" rel="noreferrer">MakerWorld</a>
          <a href="https://www.myminifactory.com/" target="_blank" rel="noreferrer">MyMiniFactory</a>
          <a href="https://cults3d.com/" target="_blank" rel="noreferrer">Cults3D</a>
          <a href="https://thangs.com/" target="_blank" rel="noreferrer">Thangs</a>
        </div>
        <label>Quantity<input name="quantity" type="number" min="1" defaultValue="1" required /></label>
        <label>Material<select value={material} onChange={(e) => { setMaterial(e.target.value as Material); setSelectedColorId(''); setSelectedColorIds([]); }}><option>PLA</option><option>PETG</option></select></label>
        <label className="checkbox-label field-full"><input type="checkbox" checked={multiColor} onChange={(event) => { setMultiColor(event.target.checked); setSelectedColorId(''); setSelectedColorIds([]); }} /> Multi-color printing (select 2–4 colors)</label>
        {!multiColor && <label>Available color
          <details className="color-select">
            <summary>
              <ColorSwatch color={selectedColor} className="selected-color-swatch" />
              <span>{selectedColor ? colorOptionLabel(selectedColor) : 'Select color'}</span>
            </summary>
            <div className="color-select-menu">
              {colors.map((color) => (
                <button
                  key={color.id}
                  type="button"
                  className={color.id === selectedColorId ? 'selected' : ''}
                  onClick={(event) => {
                    setSelectedColorId(color.id);
                    event.currentTarget.closest('details')?.removeAttribute('open');
                  }}
                >
                  <ColorSwatch color={color} className="selected-color-swatch" />
                  <span className="color-option-name">{color.name}{color.twoTone && color.secondaryColorName ? ` + ${color.secondaryColorName}` : ''}</span>
                  <span className="color-option-effects">
                    {color.glowInTheDark && <span className="status">Glow</span>}
                    {color.metallic && <span className="status">Metallic</span>}
                    {color.transparent && <span className="status">Transparent</span>}
                    {color.twoTone && <span className="status">Two-tone</span>}
                  </span>
                  <span className="color-option-quantity">{typeof color.displayGrams === 'number' ? `${color.displayGrams} g` : '—'}</span>
                </button>
              ))}
            </div>
          </details>
        </label>}
        {multiColor && <MultiColorPicker colors={colors} selectedIds={selectedColorIds} onChange={setSelectedColorIds} />}
        <label>Layer height<select name="layerHeight" defaultValue="0.2"><option value="0.12">0.12 mm fine</option><option value="0.2">0.20 mm standard</option><option value="0.28">0.28 mm draft</option></select></label>
        <label>Infill percentage<input name="infillPercent" type="number" min="0" max="100" defaultValue="15" /></label>
        <label>Estimated filament grams<input name="estimatedFilamentGrams" type="number" min="0" value={estimatedFilamentGrams || ''} onChange={(event) => setEstimatedFilamentGrams(Number(event.target.value) || 0)} placeholder="Example: 125" /></label>
        <div className="estimate-box">
          <span>Estimated material cost</span>
          <strong>{selectedColors.length && estimatedFilamentGrams > 0 ? formatMoney(estimatedMaterialCostCents) : 'Select color(s) and enter grams'}</strong>
          {selectedColors.length > 0 && estimatedFilamentGrams > 0 && <small>Uses the selected material tier rate. Final quote may include machine time, setup, finishing, tax, and delivery.</small>}
        </div>
        <label>Dimensions<input name="dimensions" placeholder="Example: 150 × 90 × 40 mm" /></label>
        <label>Scale<input name="scale" placeholder="Example: 100%" /></label>
        <label>Delivery<select name="deliveryMethod"><option>Local pickup</option><option>Standard shipping</option><option>Expedited shipping</option></select></label>
        <label>Requested completion date<input name="requestedCompletionDate" type="date" /></label>
        <label className="checkbox-label"><input name="supportsAllowed" type="checkbox" defaultChecked /> Supports may be used</label>
        <label className="field-full">Special instructions<textarea name="specialInstructions" rows={4} maxLength={1200} /></label>
        <label className="checkbox-label field-full"><input type="checkbox" required /> I have permission to print this model.</label>
        {error && <div className="alert alert-error field-full">{error}</div>}
        <div className="field-full form-actions">
          <button className="button" disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</button>
          <Link className="button button-secondary" to="/color-requests">Request a missing color</Link>
        </div>
      </form>
    </Page>
  );
}

function colorOptionLabel(color: ColorOption) {
  return `${color.name}${color.twoTone && color.secondaryColorName ? ` + ${color.secondaryColorName}` : ''}${color.glowInTheDark ? ' · Glow in the dark' : ''}${color.metallic ? ' · Metallic' : ''}${color.transparent ? ' · Transparent' : ''}${color.twoTone ? ' · Two-tone' : ''} · ${color.stockLabel}`;
}

function MultiColorPicker({ colors, selectedIds, onChange }: { colors: ColorOption[]; selectedIds: string[]; onChange(ids: string[]): void }) {
  function toggleColor(colorId: string) {
    if (selectedIds.includes(colorId)) onChange(selectedIds.filter((id) => id !== colorId));
    else if (selectedIds.length < 4) onChange([...selectedIds, colorId]);
  }
  return (
    <fieldset className="multi-color-picker field-full">
      <legend>Colors selected: {selectedIds.length}/4</legend>
      <div className="multi-color-grid">
        {colors.map((color) => <label key={color.id} className={selectedIds.includes(color.id) ? 'selected' : ''}><input type="checkbox" checked={selectedIds.includes(color.id)} disabled={!selectedIds.includes(color.id) && selectedIds.length >= 4} onChange={() => toggleColor(color.id)} /><ColorSwatch color={color} className="selected-color-swatch" /><span>{colorOptionLabel(color)}</span></label>)}
      </div>
    </fieldset>
  );
}

function ColorSwatch({ color, className }: { color?: ColorOption; className: string }) {
  const effects = [
    color?.transparent ? 'swatch-transparent' : '',
    color?.metallic ? 'swatch-metallic' : '',
    color?.glowInTheDark ? 'swatch-glow' : '',
    color?.twoTone ? 'swatch-two-tone' : '',
  ].filter(Boolean).join(' ');
  return (
    <span
      className={`${className} effect-swatch ${effects}`}
      style={{ '--swatch-color': color?.hex ?? '#ffffff', '--swatch-secondary': color?.secondaryColorHex ?? '#ffffff' } as React.CSSProperties}
      aria-label={color ? `${color.name} color swatch` : undefined}
      aria-hidden={color ? undefined : true}
    />
  );
}

export function OrdersPage() {
  const { user } = useAuth();
  const { data, loading } = useRealtimeQuery<Record<string, Order>>(user ? 'orders' : null, 'customerId', user?.uid ?? '');
  if (loading) return <Loading />;
  const orders = objectValues(data).filter((order) => order.customerId === user?.uid).sort((a, b) => b.createdAt - a.createdAt);
  return <Page title="Orders"><section className="panel"><OrderTable orders={orders} /></section></Page>;
}

export function SharedImagesPage() {
  const { data: imageMap, loading } = useRealtimeValue<Record<string, SharedImage>>('sharedImages');
  const images = objectValues(imageMap).sort((a, b) => (b.sharedAt ?? b.createdAt) - (a.sharedAt ?? a.createdAt));
  return (
    <Page title="Shared images" intro="Images shared by the print shop.">
      <section className="panel">
        {loading ? <Loading /> : images.length === 0 ? <p className="muted">No images have been shared yet.</p> : (
          <div className="image-gallery">
            {images.map((image) => (
              <article className="image-card" key={image.id}>
                <a href={image.imageData} target="_blank" rel="noreferrer"><img src={image.imageData} alt={image.title} /></a>
                <div className="image-card-body">
                  <strong>{image.title}</strong>
                  {image.description && <p>{image.description}</p>}
                  <small>Shared {formatDate(image.sharedAt ?? image.createdAt)}</small>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </Page>
  );
}

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const { user, isAdmin } = useAuth();
  const { data: order, loading } = useRealtimeValue<Order>(id ? `orders/${id}` : null);
  const { data: quoteMap } = useRealtimeValue<Record<string, Quote>>(id ? `quotes/${id}` : null);
  const { data: messages } = useRealtimeValue<Record<string, { id: string; senderId: string; senderRole: string; message: string; createdAt: number }>>(id ? `orderMessages/${id}` : null);
  const { data: statusHistory } = useRealtimeValue<Record<string, { id: string; newStatus: string; changedAt: number; customerVisibleNote?: string }>>(id ? `orderStatusHistory/${id}` : null);
  const { data: plaColors } = useRealtimeValue<Record<string, ColorOption>>('colors/PLA');
  const { data: petgColors } = useRealtimeValue<Record<string, ColorOption>>('colors/PETG');
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState('');
  const [editing, setEditing] = useState(false);
  const [editMaterial, setEditMaterial] = useState<Material>('PLA');
  const [editColorId, setEditColorId] = useState('');
  const [editMultiColor, setEditMultiColor] = useState(false);
  const [editColorIds, setEditColorIds] = useState<string[]>([]);
  const [editEstimatedGrams, setEditEstimatedGrams] = useState(0);
  const [editError, setEditError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [statusError, setStatusError] = useState('');
  const quote = quoteMap?.current;
  const customerNotes = objectValues(statusHistory).filter((entry) => entry.customerVisibleNote?.trim()).sort((a, b) => b.changedAt - a.changedAt);
  const editableStatuses: Order['status'][] = ['Submitted', 'Under review', 'Waiting for customer', 'Quoted'];
  const canEdit = Boolean(order && !isAdmin && user?.uid === order.customerId && editableStatuses.includes(order.status));
  const existingOrderColorIds = new Set([order?.colorId, ...(order?.selectedColors?.map((color) => color.id) ?? [])].filter(Boolean));
  const editColors = objectValues(editMaterial === 'PLA' ? plaColors : petgColors).filter((color) => color.selectable || existingOrderColorIds.has(color.id));
  const editColor = editColors.find((color) => color.id === editColorId);
  const editSelectedColors = editMultiColor ? editColors.filter((color) => editColorIds.includes(color.id)) : editColor ? [editColor] : [];
  const editAverageTierRate = editSelectedColors.length ? editSelectedColors.reduce((sum, color) => sum + getTierRateCents(editMaterial, editEstimatedGrams, color), 0) / editSelectedColors.length : 0;
  const editEstimatedCost = editSelectedColors.length ? Math.round(editEstimatedGrams * editAverageTierRate) : order?.estimatedMaterialCostCents ?? 0;

  useEffect(() => {
    if (!editing) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditing(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [editing]);

  if (loading) return <Loading />;
  if (!order) return <Page title="Order not found"><div className="alert alert-error">The order does not exist or you cannot access it.</div></Page>;

  async function submitMessage(event: FormEvent) {
    event.preventDefault();
    if (!user || !order || !message.trim()) return;
    setMessageError('');
    try {
      await sendOrderMessage(order.id, user.uid, isAdmin ? 'Administrator' : 'Customer', message);
      setMessage('');
    } catch (reason) {
      setMessageError(reason instanceof Error ? reason.message : 'Unable to send message or notify administrators.');
    }
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!order) return;
    const form = new FormData(event.currentTarget);
    const estimatedFilamentGrams = Number(form.get('estimatedFilamentGrams') || 0);
    if (editMultiColor && editSelectedColors.length < 2) {
      setEditError('Select at least two colors for multi-color printing.');
      return;
    }
    const selectedColorName = editSelectedColors.map((color) => color.name).join(' + ') || (editColorId === order.colorId ? order.colorName : 'Color requested separately');
    const estimatedMaterialCostCents = editSelectedColors.length ? editEstimatedCost : order.estimatedMaterialCostCents;
    setEditError('');
    try {
      await updateCustomerOrder(order, {
        modelName: String(form.get('modelName')).trim(),
        modelUrl: String(form.get('modelUrl')).trim(),
        quantity: Number(form.get('quantity')),
        material: editMaterial,
        colorId: editSelectedColors[0]?.id ?? '',
        colorName: selectedColorName,
        multiColor: editMultiColor,
        selectedColors: editSelectedColors.map((color) => ({ id: color.id, name: color.name })),
        layerHeight: Number(form.get('layerHeight')),
        infillPercent: Number(form.get('infillPercent')),
        supportsAllowed: form.get('supportsAllowed') === 'on',
        dimensions: String(form.get('dimensions') || ''),
        scale: String(form.get('scale') || ''),
        specialInstructions: String(form.get('specialInstructions') || ''),
        deliveryMethod: String(form.get('deliveryMethod')) as Order['deliveryMethod'],
        requestedCompletionDate: String(form.get('requestedCompletionDate') || ''),
        estimatedFilamentGrams,
        estimatedMaterialCostCents,
      });
      setEditing(false);
    } catch (reason) {
      setEditError(reason instanceof Error ? reason.message : 'Unable to update order.');
    }
  }

  async function cancelOrder() {
    if (!order || !window.confirm(`Cancel order ${order.orderNumber}? This cannot be undone.`)) return;
    setEditError('');
    try {
      await cancelCustomerOrder(order);
    } catch (reason) {
      setEditError(reason instanceof Error ? reason.message : 'Unable to cancel order.');
    }
  }

  async function updateOrderStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!order || !user || !isAdmin) return;
    const form = new FormData(event.currentTarget);
    setStatusError('');
    setStatusMessage('');
    try {
      await adminUpdateOrderStatus(
        order,
        String(form.get('status')) as Order['status'],
        String(form.get('paymentStatus')) as Order['paymentStatus'],
        user.uid,
        String(form.get('note') || ''),
      );
      setStatusMessage('Order status updated.');
    } catch (reason) {
      setStatusError(reason instanceof Error ? reason.message : 'Unable to update order status.');
    }
  }

  return (
    <Page title={`Order ${order.orderNumber}`} intro={order.modelName}>
      <div className="detail-grid">
        <section className="panel">
          <h2>Order details</h2>
          <dl className="details-list">
            <dt>Status</dt><dd><StatusBadge value={order.status} /></dd>
            <dt>Payment</dt><dd><StatusBadge value={order.paymentStatus} /></dd>
            <dt>Material</dt><dd>{order.material}</dd>
            <dt>Color</dt><dd>{order.multiColor && order.selectedColors ? order.selectedColors.map((color) => color.name).join(' + ') : order.colorName}</dd>
            <dt>Quantity</dt><dd>{order.quantity}</dd>
            <dt>Layer height</dt><dd>{order.layerHeight} mm</dd>
            <dt>Infill</dt><dd>{order.infillPercent}%</dd>
            <dt>Estimated filament</dt><dd>{order.estimatedFilamentGrams ? `${order.estimatedFilamentGrams} g` : 'Not provided'}</dd>
            <dt>Estimated color cost</dt><dd>{typeof order.estimatedMaterialCostCents === 'number' ? formatMoney(order.estimatedMaterialCostCents) : 'Not calculated'}</dd>
            {isAdmin && <><dt>Special instructions</dt><dd className="order-special-instructions">{order.specialInstructions || 'None provided'}</dd></>}
            <dt>Submitted</dt><dd>{formatDate(order.createdAt)}</dd>
            <dt>Queue position</dt><dd>{order.queuePosition ? `#${order.queuePosition}` : 'Not queued'}</dd>
            {order.queuedAt && <><dt>Queued</dt><dd>{formatDate(order.queuedAt)}</dd></>}
          </dl>
          <div className="button-row"><a className="button button-secondary" href={order.modelUrl} target="_blank" rel="noreferrer">Open model link</a>{canEdit && <button className="button" onClick={() => { setEditMaterial(order.material); setEditColorId(order.colorId ?? ''); setEditMultiColor(order.multiColor === true); setEditColorIds(order.selectedColors?.map((color) => color.id) ?? []); setEditEstimatedGrams(order.estimatedFilamentGrams ?? 0); setEditError(''); setEditing(true); }}>Edit request</button>}{canEdit && <button className="button button-danger" onClick={() => void cancelOrder()}>Cancel order</button>}</div>
          {editError && !editing && <div className="alert alert-error">{editError}</div>}
          {customerNotes.length > 0 && <div className="customer-notes"><h3>Updates from the print shop</h3>{customerNotes.map((entry) => <article key={entry.id}><p>{entry.customerVisibleNote}</p><small>{entry.newStatus} · {formatDate(entry.changedAt)}</small></article>)}</div>}
          {isAdmin && <div className="customer-notes"><h3>Customer special instructions</h3><p>{order.specialInstructions || 'No special instructions provided.'}</p></div>}
        </section>

        {isAdmin && <form className="panel form-stack" onSubmit={updateOrderStatus}>
          <h2>Update order status</h2>
          <label>Order status<select name="status" defaultValue={order.status}>{detailOrderStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label>Payment status<select name="paymentStatus" defaultValue={order.paymentStatus}>{detailPaymentStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label>Customer-visible note<textarea name="note" rows={3} /></label>
          {statusError && <div className="alert alert-error">{statusError}</div>}
          {statusMessage && <div className="alert alert-success">{statusMessage}</div>}
          <button className="button">Save status</button>
        </form>}

        <section className="panel">
          <h2>Quote</h2>
          {quote ? (
            <>
              <dl className="details-list">
                <dt>Total</dt><dd>{formatMoney(quote.totalCents)}</dd>
                <dt>Estimated time</dt><dd>{quote.estimatedPrintHours} hours</dd>
                <dt>Estimated material</dt><dd>{quote.estimatedFilamentGrams} g</dd>
                <dt>Status</dt><dd><StatusBadge value={quote.status} /></dd>
              </dl>
              {user && order.status === 'Quoted' && quote.status === 'Sent' && (
                <div className="button-row">
                  <button className="button" onClick={() => void setQuoteDecision(order.id, user.uid, 'Accepted')}>Accept quote</button>
                  <button className="button button-danger" onClick={() => void setQuoteDecision(order.id, user.uid, 'Declined')}>Decline</button>
                </div>
              )}
            </>
          ) : <p className="muted">A quote has not been posted yet.</p>}
        </section>
      </div>

      <section className="panel">
        <h2>Messages</h2>
        <div className="message-list">
          {objectValues(messages).sort((a, b) => a.createdAt - b.createdAt).map((item) => (
            <article className="message" key={item.id}>
              <strong>{item.senderRole}</strong>
              <p>{item.message}</p>
              <small>{formatDate(item.createdAt)}</small>
            </article>
          ))}
        </div>
        <form className="message-form" onSubmit={submitMessage}>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={2000} placeholder="Write a message" required />
          <button className="button">Send</button>
        </form>
        {messageError && <div className="alert alert-error">{messageError}</div>}
      </section>
      {editing && canEdit && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(false); }}>
        <form className="modal-panel form-grid" role="dialog" aria-modal="true" aria-labelledby="edit-order-title" onSubmit={submitEdit}>
          <h2 id="edit-order-title" className="field-full">Edit {order.orderNumber}</h2>
          {order.status === 'Quoted' && <div className="alert alert-error field-full">Editing this quoted request returns it to Submitted for a revised quote.</div>}
          <label>Model name<input name="modelName" defaultValue={order.modelName} required autoFocus /></label>
          <label>Model link<input name="modelUrl" type="url" defaultValue={order.modelUrl} required /></label>
          <label>Quantity<input name="quantity" type="number" min="1" defaultValue={order.quantity} required /></label>
          <label>Material<select value={editMaterial} onChange={(event) => { setEditMaterial(event.target.value as Material); setEditColorId(''); setEditColorIds([]); }}><option>PLA</option><option>PETG</option></select></label>
          <label className="checkbox-label field-full"><input type="checkbox" checked={editMultiColor} onChange={(event) => { setEditMultiColor(event.target.checked); setEditColorId(''); setEditColorIds([]); }} /> Multi-color printing (select 2–4 colors)</label>
          {!editMultiColor && <label>Color<select value={editColorId} onChange={(event) => setEditColorId(event.target.value)}><option value="">Color requested separately</option>{editColors.map((color) => <option key={color.id} value={color.id}>{colorOptionLabel(color)}</option>)}</select></label>}
          {editMultiColor && <MultiColorPicker colors={editColors} selectedIds={editColorIds} onChange={setEditColorIds} />}
          <label>Layer height<select name="layerHeight" defaultValue={order.layerHeight}><option value="0.12">0.12 mm fine</option><option value="0.2">0.20 mm standard</option><option value="0.28">0.28 mm draft</option></select></label>
          <label>Infill percentage<input name="infillPercent" type="number" min="0" max="100" defaultValue={order.infillPercent} /></label>
          <label>Estimated filament grams<input name="estimatedFilamentGrams" type="number" min="0" value={editEstimatedGrams || ''} onChange={(event) => setEditEstimatedGrams(Number(event.target.value) || 0)} /></label>
          <div className="estimate-box"><span>Estimated color cost</span><strong>{editSelectedColors.length && editEstimatedGrams > 0 ? formatMoney(editEstimatedCost) : 'Select color(s) and enter grams'}</strong>{editSelectedColors.length > 0 && editEstimatedGrams > 0 && <small>Uses the selected material tier rate.</small>}</div>
          <label>Dimensions<input name="dimensions" defaultValue={order.dimensions} /></label>
          <label>Scale<input name="scale" defaultValue={order.scale} /></label>
          <label>Delivery<select name="deliveryMethod" defaultValue={order.deliveryMethod}><option>Local pickup</option><option>Standard shipping</option><option>Expedited shipping</option></select></label>
          <label>Requested completion date<input name="requestedCompletionDate" type="date" defaultValue={order.requestedCompletionDate} /></label>
          <label className="checkbox-label"><input name="supportsAllowed" type="checkbox" defaultChecked={order.supportsAllowed} /> Supports may be used</label>
          <label className="field-full">Special instructions<textarea name="specialInstructions" rows={4} defaultValue={order.specialInstructions} /></label>
          {editError && <div className="alert alert-error field-full">{editError}</div>}
          <div className="field-full button-row"><button className="button">Save changes</button><button className="button button-secondary" type="button" onClick={() => setEditing(false)}>Cancel</button></div>
        </form>
      </div>}
    </Page>
  );
}

export function ColorsPage() {
  const { data: pla } = useRealtimeValue<Record<string, ColorOption>>('colors/PLA');
  const { data: petg } = useRealtimeValue<Record<string, ColorOption>>('colors/PETG');
  return (
    <Page title="Materials and colors" intro="Only PLA and PETG are supported.">
      <ColorSection title="PLA" colors={objectValues(pla)} />
      <ColorSection title="PETG" colors={objectValues(petg)} />
    </Page>
  );
}

export function ColorRequestsPage() {
  const { user, profile } = useAuth();
  const { data } = useRealtimeQuery<Record<string, ColorRequest>>(user ? 'colorRequests' : null, 'customerId', user?.uid ?? '');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !profile) return;
    const form = new FormData(event.currentTarget);
    setError('');
    setSuccess('');
    try {
      await createColorRequest({
        customerId: user.uid,
        customerName: profile.displayName,
        material: String(form.get('material')) as Material,
        requestedColorName: String(form.get('requestedColorName')),
        colorHex: String(form.get('colorHex') || ''),
        referenceImageUrl: String(form.get('referenceImageUrl') || ''),
        preferredBrand: String(form.get('preferredBrand') || ''),
        approximateAmountGrams: Number(form.get('approximateAmountGrams') || 0),
        requestedCompletionDate: String(form.get('requestedCompletionDate') || ''),
        similarColorsAccepted: form.get('similarColorsAccepted') === 'on',
        willingToWait: form.get('willingToWait') === 'on',
        willingToPaySpecialOrderFee: form.get('willingToPaySpecialOrderFee') === 'on',
        willingToPayForFullSpool: form.get('willingToPayForFullSpool') === 'on',
        notes: String(form.get('notes') || ''),
      });
      event.currentTarget.reset();
      setSuccess('Color request submitted.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to submit request.');
    }
  }

  const requests = objectValues(data).filter((item) => item.customerId === user?.uid).sort((a, b) => b.createdAt - a.createdAt);

  return (
    <Page title="Color requests">
      <form className="panel form-grid" onSubmit={submit}>
        <label>Material<select name="material"><option>PLA</option><option>PETG</option></select></label>
        <label>Requested color<input name="requestedColorName" required /></label>
        <label>Color reference<input name="colorHex" type="color" defaultValue="#000000" /></label>
        <label>Reference image URL<input name="referenceImageUrl" type="url" placeholder="https://" /></label>
        <label>Preferred brand<input name="preferredBrand" /></label>
        <label>Approximate amount needed<input name="approximateAmountGrams" type="number" min="0" /></label>
        <label>Requested completion date<input name="requestedCompletionDate" type="date" /></label>
        <label className="checkbox-label"><input name="similarColorsAccepted" type="checkbox" /> Similar colors are acceptable</label>
        <label className="checkbox-label"><input name="willingToWait" type="checkbox" /> I can wait for restocking</label>
        <label className="checkbox-label"><input name="willingToPaySpecialOrderFee" type="checkbox" /> I may pay a special-order fee in person</label>
        <label className="checkbox-label"><input name="willingToPayForFullSpool" type="checkbox" /> I may pay for a full spool in person</label>
        <label className="field-full">Notes<textarea name="notes" rows={3} /></label>
        {error && <div className="alert alert-error field-full">{error}</div>}
        {success && <div className="alert alert-success field-full">{success}</div>}
        <div className="field-full"><button className="button">Submit color request</button></div>
      </form>
      <section className="panel">
        <h2>Your requests</h2>
        <table><thead><tr><th>Material</th><th>Color</th><th>Status</th><th>Submitted</th></tr></thead>
          <tbody>{requests.map((request) => <tr key={request.id}><td>{request.material}</td><td>{request.requestedColorName}</td><td><StatusBadge value={request.status} /></td><td>{formatDate(request.createdAt)}</td></tr>)}</tbody>
        </table>
      </section>
    </Page>
  );
}

export function BalancePage() {
  const { user } = useAuth();
  const { data: ledger, loading } = useRealtimeValue<FinancialLedger>(user ? `financialLedgers/${user.uid}` : null);
  if (loading) return <Loading />;
  const balance = normalizedBalanceCents(ledger?.summary);
  const isLegacyLedger = ledger?.summary?.signConvention !== 'credit-positive';
  const message = balance < 0 ? `You currently owe ${formatMoney(Math.abs(balance))}.` : balance > 0 ? `You have ${formatMoney(balance)} in account credit.` : 'Your account is paid in full.';
  const transactions = objectValues(ledger?.transactions).sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Page title="Balance" intro="Payments are collected in person and recorded by an administrator.">
      <div className="balance-banner"><span>Current balance</span><strong>{formatMoney(balance)}</strong><p>{message}</p></div>
      <section className="panel"><h2>Transaction history</h2>
        <table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Amount</th></tr></thead>
          <tbody>{transactions.map((item) => { const amount = isLegacyLedger ? -item.amountCents : item.amountCents; return <tr key={item.id}><td>{formatDate(item.createdAt)}</td><td>{item.type}</td><td>{item.description}</td><td className={amount < 0 ? 'money-due' : 'money-credit'}>{formatMoney(amount)}</td></tr>; })}</tbody>
        </table>
      </section>
    </Page>
  );
}

export function NotificationsPage() {
  const { user, isAdmin } = useAuth();
  const notificationPath = isAdmin ? 'adminNotifications' : user ? `notifications/${user.uid}` : null;
  const { data, error } = useRealtimeValue<Record<string, AppNotification>>(notificationPath);
  const notifications = objectValues(data).sort((a, b) => b.createdAt - a.createdAt);
  async function markRead(notificationId: string) {
    if (!user) return;
    if (isAdmin) await markAdminNotificationRead(notificationId);
    else await markNotificationRead(user.uid, notificationId);
  }
  async function removeNotification(notificationId: string) {
    if (!user || !window.confirm('Delete this notification?')) return;
    if (isAdmin) await deleteAdminNotification(notificationId);
    else await deleteNotification(user.uid, notificationId);
  }
  async function removeAllNotifications() {
    if (!user || notifications.length === 0 || !window.confirm(`Delete all ${notifications.length} notifications?`)) return;
    if (isAdmin) await deleteAllAdminNotifications();
    else await deleteAllNotifications(user.uid);
  }
  return (
    <Page title={isAdmin ? 'Admin notifications' : 'Notifications'}>
      {error && <div className="alert alert-error">Notifications could not be loaded: {error}. Publish the latest Firebase database rules.</div>}
      {notifications.length > 0 && <div className="toolbar"><button className="button button-danger" onClick={() => void removeAllNotifications()}>Delete all notifications</button></div>}
      <section className="panel notification-list">
        {!error && notifications.length === 0 && <p className="muted">No notifications yet.</p>}
        {notifications.map((item) => (
          <article key={item.id} className={`notification ${item.read ? '' : 'notification-unread'}`}>
            <div><strong>{item.title}</strong><p>{item.message}</p><small>{formatDate(item.createdAt)}</small></div>
            <div className="button-row">{item.orderId && <Link className="button button-secondary" to={`/orders/${item.orderId}`}>Open order</Link>}{!item.read && user && <button className="button button-secondary" onClick={() => void markRead(item.id)}>Mark read</button>}<button className="button button-danger" onClick={() => void removeNotification(item.id)}>Delete</button></div>
          </article>
        ))}
      </section>
    </Page>
  );
}

export function ProfilePage() {
  const { profile, refreshProfile } = useAuth();
  const [message, setMessage] = useState('');
  if (!profile) return <Loading />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    const form = new FormData(event.currentTarget);
    await saveProfile({
      ...profile,
      displayName: String(form.get('displayName')),
      firstName: String(form.get('firstName') || ''),
      lastName: String(form.get('lastName') || ''),
      phone: String(form.get('phone') || ''),
      preferredContact: String(form.get('preferredContact')) as UserProfile['preferredContact'],
      shippingAddress: String(form.get('shippingAddress') || ''),
      pickupPreference: form.get('pickupPreference') === 'on',
    });
    await refreshProfile();
    setMessage('Profile saved.');
  }

  return (
    <Page title="Profile">
      <form className="panel form-grid" onSubmit={submit}>
        <label>Display name<input name="displayName" defaultValue={profile.displayName} required /></label>
        <label>First name<input name="firstName" defaultValue={profile.firstName} /></label>
        <label>Last name<input name="lastName" defaultValue={profile.lastName} /></label>
        <label>Email<input value={profile.email} disabled /></label>
        <label>Phone<input name="phone" defaultValue={profile.phone} /></label>
        <label>Preferred contact<select name="preferredContact" defaultValue={profile.preferredContact ?? 'Email'}><option>Email</option><option>Phone</option></select></label>
        <label className="field-full">Shipping address<textarea name="shippingAddress" rows={3} defaultValue={profile.shippingAddress} /></label>
        <label className="checkbox-label field-full"><input name="pickupPreference" type="checkbox" defaultChecked={profile.pickupPreference} /> Prefer local pickup</label>
        {message && <div className="alert alert-success field-full">{message}</div>}
        <div className="field-full"><button className="button">Save profile</button></div>
      </form>
    </Page>
  );
}

function ColorSection({ title, colors }: { title: string; colors: ColorOption[] }) {
  const { user } = useAuth();
  const [message, setMessage] = useState('');

  async function requestRestock(color: ColorOption) {
    if (!user) return;
    await subscribeToRestock(user.uid, color.material, color.id);
    setMessage(`You will see an in-app update when ${color.name} ${color.material} is restocked.`);
  }

  return (
    <section className="panel">
      <div className="panel-heading"><h2>{title}</h2><Link to="/color-requests">Request another color</Link></div>
      {message && <div className="alert alert-success">{message}</div>}
      <div className="color-grid">
        {colors.length === 0 && <p className="muted">No colors have been added yet.</p>}
        {colors.filter((color) => color.availabilityStatus !== 'Hidden').map((color) => (
          <article className="color-card" key={color.id}>
            <ColorSwatch color={color} className="color-card-background" />
            <div className="color-card-content">
              <strong>{color.name}{color.twoTone && color.secondaryColorName ? ` + ${color.secondaryColorName}` : ''}</strong>
              <p>{color.material}{typeof color.displayGrams === 'number' ? ` · ${color.displayGrams} g available` : ''}</p>
              <div className="color-effects">
                {color.glowInTheDark && <span className="status">Glow in the dark</span>}
                {color.metallic && <span className="status">Metallic</span>}
                {color.transparent && <span className="status">Transparent</span>}
                {color.twoTone && <span className="status">Two-tone</span>}
              </div>
              <StatusBadge value={color.stockLabel} />
              {!color.selectable && <button className="text-button" onClick={() => void requestRestock(color)}>Notify me when available</button>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function OrderTable({ orders }: { orders: Order[] }) {
  if (orders.length === 0) return <p className="muted">No orders yet.</p>;
  return (
    <div className="table-wrap"><table><thead><tr><th>Order</th><th>Model</th><th>Material</th><th>Status</th><th>Queue</th><th>Balance status</th><th>Submitted</th></tr></thead>
      <tbody>{orders.map((order) => <tr key={order.id}><td><Link to={`/orders/${order.id}`}>{order.orderNumber}</Link></td><td>{order.modelName}</td><td>{order.material} · {order.colorName}</td><td><StatusBadge value={order.status} /></td><td>{order.queuePosition ? `#${order.queuePosition}` : 'Not queued'}</td><td><StatusBadge value={order.paymentStatus} /></td><td>{formatDate(order.createdAt)}</td></tr>)}</tbody>
    </table></div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <article className="stat"><span>{label}</span><strong>{value}</strong></article>;
}

function Page({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return <><header className="page-heading"><h1>{title}</h1>{intro && <p>{intro}</p>}</header>{children}</>;
}
