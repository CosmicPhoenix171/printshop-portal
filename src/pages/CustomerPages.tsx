import { get, push, ref, set, update } from 'firebase/database';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Loading } from '../components/Loading';
import { StatusBadge } from '../components/StatusBadge';
import { db } from '../firebase';
import { useRealtimeQuery, useRealtimeValue } from '../hooks/useRealtime';
import {
  createColorRequest,
  createOrder,
  markNotificationRead,
  saveProfile,
  sendOrderMessage,
  setQuoteDecision,
  subscribeToRestock,
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
import { formatDate, formatMoney, objectValues } from '../utils';

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
        <Stat label="Current balance" value={formatMoney(ledger?.summary?.currentBalanceCents ?? 0)} />
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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const colors = objectValues(material === 'PLA' ? plaColors : petgColors).filter((color) => color.selectable);
  const selectedColor = colors.find((color) => color.id === selectedColorId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    if (colors.length > 0 && !selectedColor) {
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
        colorId: selectedColor?.id ?? '',
        colorName: selectedColor?.name ?? 'Color requested separately',
        layerHeight: Number(form.get('layerHeight')),
        infillPercent: Number(form.get('infillPercent')),
        supportsAllowed: form.get('supportsAllowed') === 'on',
        dimensions: String(form.get('dimensions') || ''),
        scale: String(form.get('scale') || ''),
        specialInstructions: String(form.get('specialInstructions') || ''),
        deliveryMethod: String(form.get('deliveryMethod')) as Order['deliveryMethod'],
        requestedCompletionDate: String(form.get('requestedCompletionDate') || ''),
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
        <label>Quantity<input name="quantity" type="number" min="1" defaultValue="1" required /></label>
        <label>Material<select value={material} onChange={(e) => { setMaterial(e.target.value as Material); setSelectedColorId(''); }}><option>PLA</option><option>PETG</option></select></label>
        <label>Available color
          <details className="color-select">
            <summary>
              <span className="selected-color-swatch" style={{ backgroundColor: selectedColor?.hex ?? '#ffffff' }} aria-hidden="true" />
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
                  <span className="selected-color-swatch" style={{ backgroundColor: color.hex }} aria-hidden="true" />
                  <span>{colorOptionLabel(color)}</span>
                </button>
              ))}
            </div>
          </details>
        </label>
        <label>Layer height<select name="layerHeight" defaultValue="0.2"><option value="0.12">0.12 mm fine</option><option value="0.2">0.20 mm standard</option><option value="0.28">0.28 mm draft</option></select></label>
        <label>Infill percentage<input name="infillPercent" type="number" min="0" max="100" defaultValue="15" /></label>
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
  return `${color.name}${color.glowInTheDark ? ' · Glow in the dark' : ''}${color.metallic ? ' · Metallic' : ''}${color.transparent ? ' · Transparent' : ''} · ${color.stockLabel}`;
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
  const [message, setMessage] = useState('');
  const quote = quoteMap?.current;

  if (loading) return <Loading />;
  if (!order) return <Page title="Order not found"><div className="alert alert-error">The order does not exist or you cannot access it.</div></Page>;

  async function submitMessage(event: FormEvent) {
    event.preventDefault();
    if (!user || !order || !message.trim()) return;
    await sendOrderMessage(order.id, user.uid, isAdmin ? 'Administrator' : 'Customer', message);
    setMessage('');
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
            <dt>Color</dt><dd>{order.colorName}</dd>
            <dt>Quantity</dt><dd>{order.quantity}</dd>
            <dt>Layer height</dt><dd>{order.layerHeight} mm</dd>
            <dt>Infill</dt><dd>{order.infillPercent}%</dd>
            <dt>Submitted</dt><dd>{formatDate(order.createdAt)}</dd>
          </dl>
          <a className="button button-secondary" href={order.modelUrl} target="_blank" rel="noreferrer">Open model link</a>
        </section>

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
              {user && quote.status === 'Sent' && (
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
      </section>
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
  const balance = ledger?.summary?.currentBalanceCents ?? 0;
  const message = balance > 0 ? `You currently owe ${formatMoney(balance)}.` : balance < 0 ? `You have ${formatMoney(Math.abs(balance))} in account credit.` : 'Your account is paid in full.';
  const transactions = objectValues(ledger?.transactions).sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Page title="Balance" intro="Payments are collected in person and recorded by an administrator.">
      <div className="balance-banner"><span>Current balance</span><strong>{formatMoney(balance)}</strong><p>{message}</p></div>
      <section className="panel"><h2>Transaction history</h2>
        <table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Amount</th></tr></thead>
          <tbody>{transactions.map((item) => <tr key={item.id}><td>{formatDate(item.createdAt)}</td><td>{item.type}</td><td>{item.description}</td><td className={item.amountCents > 0 ? 'money-due' : 'money-credit'}>{formatMoney(item.amountCents)}</td></tr>)}</tbody>
        </table>
      </section>
    </Page>
  );
}

export function NotificationsPage() {
  const { user } = useAuth();
  const { data } = useRealtimeValue<Record<string, AppNotification>>(user ? `notifications/${user.uid}` : null);
  const notifications = objectValues(data).sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Page title="Notifications">
      <section className="panel notification-list">
        {notifications.length === 0 && <p className="muted">No notifications yet.</p>}
        {notifications.map((item) => (
          <article key={item.id} className={`notification ${item.read ? '' : 'notification-unread'}`}>
            <div><strong>{item.title}</strong><p>{item.message}</p><small>{formatDate(item.createdAt)}</small></div>
            {!item.read && user && <button className="button button-secondary" onClick={() => void markNotificationRead(user.uid, item.id)}>Mark read</button>}
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
            <span className="swatch" style={{ backgroundColor: color.hex }} aria-label={`${color.name} color swatch`} />
            <div className="color-card-content">
              <strong>{color.name}</strong>
              <p>{color.material}{typeof color.displayGrams === 'number' ? ` · ${color.displayGrams} g available` : ''}</p>
              <div className="color-effects">
                {color.glowInTheDark && <span className="status">Glow in the dark</span>}
                {color.metallic && <span className="status">Metallic</span>}
                {color.transparent && <span className="status">Transparent</span>}
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
    <div className="table-wrap"><table><thead><tr><th>Order</th><th>Model</th><th>Material</th><th>Status</th><th>Balance status</th><th>Date</th></tr></thead>
      <tbody>{orders.map((order) => <tr key={order.id}><td><Link to={`/orders/${order.id}`}>{order.orderNumber}</Link></td><td>{order.modelName}</td><td>{order.material} · {order.colorName}</td><td><StatusBadge value={order.status} /></td><td><StatusBadge value={order.paymentStatus} /></td><td>{formatDate(order.createdAt)}</td></tr>)}</tbody>
    </table></div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <article className="stat"><span>{label}</span><strong>{value}</strong></article>;
}

function Page({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return <><header className="page-heading"><h1>{title}</h1>{intro && <p>{intro}</p>}</header>{children}</>;
}
