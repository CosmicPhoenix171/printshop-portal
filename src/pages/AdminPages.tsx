import { push, ref, set, update } from 'firebase/database';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Loading } from '../components/Loading';
import { StatusBadge } from '../components/StatusBadge';
import { db } from '../firebase';
import { useRealtimeValue } from '../hooks/useRealtime';
import {
  adminRecordBalanceTransaction,
  adminDeleteImage,
  adminDeleteSpool,
  adminRebuildPublicInventory,
  adminSaveInventoryDefaults,
  adminSaveQuote,
  adminSaveSpool,
  adminSetImageShared,
  adminUpdateOrderStatus,
  adminUploadImage,
  buildSpoolColorId,
  imageFileToBase64,
} from '../services';
import type {
  BalanceTransaction,
  ColorRequest,
  FilamentSpool,
  InventorySettings,
  Material,
  Order,
  OrderStatus,
  PaymentStatus,
  PrintQueueItem,
  Printer,
  Quote,
  QuoteFilamentLine,
  QuoteTimeLine,
  SharedImage,
  UserProfile,
  FinancialLedger,
} from '../types';
import { calculateMaterialCostCents, formatDate, formatMoney, normalizedBalanceCents, objectValues } from '../utils';

const orderStatuses: OrderStatus[] = ['Submitted','Under review','Waiting for customer','Quoted','Accepted','Queued','Printing','Paused','Failed','Reprinting','Post-processing','Quality check','Ready for pickup','Ready to ship','Shipped','Completed','Cancelled'];
const paymentStatuses: PaymentStatus[] = ['Not charged','Balance due','Deposit paid','Partially paid','Paid in full','Overpaid','Refund due','Refunded','Waived','Cancelled'];
const quickColors = [
  { name: 'Red', hex: '#FF0000' },
  { name: 'Red-orange', hex: '#FF4000' },
  { name: 'Orange', hex: '#FF8000' },
  { name: 'Yellow-orange', hex: '#FFBF00' },
  { name: 'Yellow', hex: '#FFFF00' },
  { name: 'Yellow-green', hex: '#80C000' },
  { name: 'Green', hex: '#008000' },
  { name: 'Blue-green', hex: '#008080' },
  { name: 'Blue', hex: '#0000FF' },
  { name: 'Blue-violet', hex: '#4000C0' },
  { name: 'Violet', hex: '#8000FF' },
  { name: 'Red-violet', hex: '#C00080' },
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Gray', hex: '#808080' },
  { name: 'Black', hex: '#000000' },
] as const;
const standardSpoolSizes = [250, 500, 750, 1000, 2000, 3000, 5000] as const;
const fallbackInventorySettings: InventorySettings = {
  reservedWeightGrams: 0,
  minimumReserveGrams: 50,
  pricePerGramCents: 4,
  wasteAllowancePercent: 10,
  reorderThresholdGrams: 200,
  smallRateCents: 25,
  mediumRateCents: 15,
  largeRateCents: 10,
  bulkRateCents: 5,
};
const petgFallbackInventorySettings: InventorySettings = { ...fallbackInventorySettings, smallRateCents: 30, mediumRateCents: 20, largeRateCents: 15, bulkRateCents: 10 };

function parseQuoteLines(value: string, type: 'filament' | 'time'): QuoteFilamentLine[] | QuoteTimeLine[] {
  const lines = value.split('\n').map((line) => line.trim()).filter(Boolean);
  if (type === 'filament') return lines.flatMap((line): QuoteFilamentLine[] => {
    const parts = line.split('|').map((part) => part.trim());
    if (parts.length === 4) {
      const [filament, model, meters, grams] = parts;
      const parsedMeters = Number(meters);
      const parsedGrams = Number(grams);
      return Number.isFinite(parsedMeters) && Number.isFinite(parsedGrams) ? [{ filament, model, meters: parsedMeters, grams: parsedGrams }] : [];
    }
    return [];
  });
  return lines.flatMap((line): QuoteTimeLine[] => {
    const parts = line.split('|').map((part) => part.trim());
    if (parts.length === 2) {
      return [{ model: parts[0], time: parts[1] }];
    }
    return [];
  });
}

function formatQuoteLines(lines: QuoteFilamentLine[] | QuoteTimeLine[] | undefined, type: 'filament' | 'time'): string {
  if (!lines) return '';
  return type === 'filament'
    ? (lines as QuoteFilamentLine[]).map((line) => `${line.filament} | ${line.model} | ${line.meters} | ${line.grams}`).join('\n')
    : (lines as QuoteTimeLine[]).map((line) => `${line.model} | ${line.time}`).join('\n');
}

function synchronizeColorName(event: React.ChangeEvent<HTMLInputElement>) {
  const hex = event.currentTarget.value.toUpperCase();
  const colorName = event.currentTarget.form?.elements.namedItem('colorName');
  if (!(colorName instanceof HTMLInputElement)) return;
  colorName.value = quickColors.find((color) => color.hex === hex)?.name ?? `Custom ${hex}`;
  colorName.dispatchEvent(new Event('input', { bubbles: true }));
}

export function AdminOrdersPage() {
  const { user } = useAuth();
  const { data, loading } = useRealtimeValue<Record<string, Order>>('orders');
  const { data: spools } = useRealtimeValue<Record<string, FilamentSpool>>('filamentSpools');
  const { data: requests } = useRealtimeValue<Record<string, ColorRequest>>('colorRequests');
  const { data: inventoryDefaults } = useRealtimeValue<Partial<Record<Material, InventorySettings>>>('businessSettings/private/inventoryDefaults');
  const [filter, setFilter] = useState('All');
  const [selected, setSelected] = useState<Order | null>(null);
  const [success, setSuccess] = useState('');
  const { data: currentQuote } = useRealtimeValue<Quote>(selected ? `quotes/${selected.id}/current` : null);

  useEffect(() => {
    if (!selected) return;
    const current = data?.[selected.id];
    if (current && current !== selected) setSelected(current);
  }, [data, selected]);

  if (loading) return <Loading />;
  const orders = objectValues(data).sort((a, b) => b.createdAt - a.createdAt).filter((order) => filter === 'All' || order.status === filter);
  const allOrders = objectValues(data);
  const selectedInventorySettings = selected ? inventoryDefaults?.[selected.material] ?? (selected.material === 'PLA' ? fallbackInventorySettings : petgFallbackInventorySettings) : fallbackInventorySettings;
  const calculatedMaterialCostCents = selected ? calculateMaterialCostCents(selected.material, currentQuote?.estimatedFilamentGrams ?? selected.estimatedFilamentGrams ?? 0, selectedInventorySettings.wasteAllowancePercent, selectedInventorySettings) : 0;

  function recalculateMaterialCost(event: React.ChangeEvent<HTMLInputElement>) {
    if (!selected) return;
    const materialCost = event.currentTarget.form?.elements.namedItem('materialCost');
    if (!(materialCost instanceof HTMLInputElement)) return;
    const grams = Number(event.currentTarget.value) || 0;
    materialCost.value = (calculateMaterialCostCents(selected.material, grams, selectedInventorySettings.wasteAllowancePercent, selectedInventorySettings) / 100).toFixed(2);
  }

  async function saveStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !user) return;
    const form = new FormData(event.currentTarget);
    await adminUpdateOrderStatus(selected, String(form.get('status')) as OrderStatus, String(form.get('paymentStatus')) as PaymentStatus, user.uid, String(form.get('note') || ''));
    setSuccess('Order updated.');
  }

  async function saveQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !user) return;
    const form = new FormData(event.currentTarget);
    const cents = (name: string) => Math.round(Number(form.get(name) || 0) * 100);
    const fields = ['materialCost','machineTimeCost','setupFee','finishingFee','shippingFee','specialColorFee','tax'] as const;
    const subtotal = fields.reduce((sum, key) => sum + cents(key), 0);
    const discount = cents('discount');
    await adminSaveQuote(selected, {
      estimatedFilamentGrams: Number(form.get('estimatedFilamentGrams') || 0),
      estimatedPrintHours: Number(form.get('estimatedPrintHours') || 0),
      materialCostCents: cents('materialCost'),
      machineTimeCostCents: 0,
      setupFeeCents: 0,
      finishingFeeCents: 0,
      shippingFeeCents: cents('shippingFee'),
      specialColorFeeCents: cents('specialColorFee'),
      discountCents: discount,
      taxCents: 0,
      totalCents: Math.max(0, subtotal - discount),
      filamentLines: [],
      timeLines: [],
      customerNotes: '',
      internalNotes: '',
      status: 'Sent',
    }, user.uid);
    setSuccess('Quote saved and sent.');
  }

  return (
    <Page title="Orders" intro="Review requests, send quotes, and manage the print workflow.">
      <div className="stat-grid">
        <Stat label="New requests" value={String(allOrders.filter((order) => order.status === 'Submitted').length)} />
        <Stat label="Currently printing" value={String(allOrders.filter((order) => order.status === 'Printing').length)} />
        <Stat label="Spools" value={String(objectValues(spools).length)} />
        <Stat label="Color requests" value={String(objectValues(requests).filter((request) => !['Completed', 'Cancelled', 'Declined'].includes(request.status)).length)} />
      </div>
      <section className="panel"><div className="panel-heading"><h2>Needs attention</h2><span className="muted">Submitted, failed, or waiting</span></div><AdminOrderTable orders={allOrders.filter((order) => ['Submitted', 'Failed', 'Waiting for customer'].includes(order.status)).slice(0, 10)} onSelect={setSelected} /></section>
      <div className="toolbar"><label>Status filter<select value={filter} onChange={(e) => setFilter(e.target.value)}><option>All</option>{orderStatuses.map((status) => <option key={status}>{status}</option>)}</select></label></div>
      <section className="panel"><AdminOrderTable orders={orders} onSelect={setSelected} /></section>
      {selected && (
        <div className="admin-split">
          <section className="panel customer-request-panel">
            <h2>Customer request</h2>
            <dl className="details-list">
              <dt>Model</dt><dd>{selected.modelName}</dd>
              <dt>Quantity</dt><dd>{selected.quantity}</dd>
              <dt>Material</dt><dd>{selected.material} · {selected.colorName}</dd>
              {selected.multiColor && selected.selectedColors && <><dt>Selected colors</dt><dd>{selected.selectedColors.map((color) => color.name).join(' + ')}</dd></>}
              <dt>Layer height</dt><dd>{selected.layerHeight} mm</dd>
              <dt>Infill</dt><dd>{selected.infillPercent}%</dd>
              <dt>Supports</dt><dd>{selected.supportsAllowed ? 'Allowed' : 'Not allowed'}</dd>
              <dt>Dimensions</dt><dd>{selected.dimensions || 'Not provided'}</dd>
              <dt>Scale</dt><dd>{selected.scale || 'Not provided'}</dd>
              <dt>Delivery</dt><dd>{selected.deliveryMethod}</dd>
              <dt>Requested date</dt><dd>{selected.requestedCompletionDate || 'Not provided'}</dd>
            </dl>
            <h3>Special instructions</h3>
            <p className="request-notes">{selected.specialInstructions || 'No special instructions provided.'}</p>
          </section>
          <form key={`${selected.id}-${selected.updatedAt}`} className="panel form-stack" onSubmit={saveStatus}>
            <h2>Update {selected.orderNumber}</h2>
            <label>Order status<select name="status" defaultValue={selected.status}>{orderStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
            <label>Payment status<select name="paymentStatus" defaultValue={selected.paymentStatus}>{paymentStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
            <label>Customer-visible note<textarea name="note" rows={3} /></label>
            <button className="button">Save status</button>
          </form>
          <form key={`${selected.id}-${currentQuote?.updatedAt ?? 'new'}`} className="panel form-grid" onSubmit={saveQuote}>
            <h2 className="field-full">{currentQuote ? 'Edit quote' : 'Create quote'}</h2>
            <label>Estimated filament grams<input name="estimatedFilamentGrams" type="number" min="0" defaultValue={currentQuote?.estimatedFilamentGrams ?? selected.estimatedFilamentGrams ?? ''} onChange={recalculateMaterialCost} /></label>
            <label>Estimated print hours<input name="estimatedPrintHours" type="number" min="0" step="0.1" defaultValue={currentQuote?.estimatedPrintHours ?? selected.estimatedPrintHours ?? ''} /></label>
            <label>Material cost<input name="materialCost" type="number" min="0" step="0.01" defaultValue={currentQuote ? currentQuote.materialCostCents / 100 : calculatedMaterialCostCents / 100} /><small>Auto-calculated from {selected.material} rates; you can override it.</small></label>
            <label>Shipping fee<input name="shippingFee" type="number" min="0" step="0.01" defaultValue={currentQuote ? currentQuote.shippingFeeCents / 100 : ''} /></label>
            <label>Special color fee<input name="specialColorFee" type="number" min="0" step="0.01" defaultValue={currentQuote ? currentQuote.specialColorFeeCents / 100 : ''} /></label>
            <label>Discount<input name="discount" type="number" min="0" step="0.01" defaultValue={currentQuote ? currentQuote.discountCents / 100 : ''} /></label>
            <div className="field-full"><button className="button">{currentQuote ? 'Update and resend quote' : 'Save and send quote'}</button></div>
          </form>
        </div>
      )}
      {success && <div className="alert alert-success">{success}</div>}
    </Page>
  );
}

export function AdminInventoryPage() {
  const { data: spools, loading } = useRealtimeValue<Record<string, FilamentSpool>>('filamentSpools');
  const { data: inventoryDefaults } = useRealtimeValue<Partial<Record<Material, InventorySettings>>>('businessSettings/private/inventoryDefaults');
  const [message, setMessage] = useState('');
  const [editingSpool, setEditingSpool] = useState<FilamentSpool | null>(null);
  const [settingsSpool, setSettingsSpool] = useState<FilamentSpool | null>(null);
  const [defaultSettingsMaterial, setDefaultSettingsMaterial] = useState<Material | null>(null);

  useEffect(() => {
    if (!editingSpool && !settingsSpool && !defaultSettingsMaterial) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setEditingSpool(null);
      setSettingsSpool(null);
      setDefaultSettingsMaterial(null);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [editingSpool, settingsSpool, defaultSettingsMaterial]);

  if (loading) return <Loading />;

  async function addSpool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const id = push(ref(db, 'filamentSpools')).key;
    if (!id) return;
    const material = String(form.get('material')) as Material;
    const colorName = String(form.get('colorName'));
    const twoTone = form.get('twoTone') === 'on';
    const secondaryColorName = twoTone ? String(form.get('secondaryColorName')).trim() : '';
    const effects = {
      glowInTheDark: form.get('glowInTheDark') === 'on',
      metallic: form.get('metallic') === 'on',
      transparent: form.get('transparent') === 'on',
      twoTone,
    };
    const colorId = buildSpoolColorId({ material, colorName, secondaryColorName, ...effects });
    const defaults = inventoryDefaults?.[material] ?? (material === 'PLA' ? fallbackInventorySettings : petgFallbackInventorySettings);
    const spool: FilamentSpool = {
      id,
      material,
      colorId,
      colorName,
      colorHex: String(form.get('colorHex')),
      startingWeightGrams: Number(form.get('startingWeightGrams')),
      currentPhysicalWeightGrams: Number(form.get('currentPhysicalWeightGrams')),
      ...defaults,
      usesCustomInventorySettings: false,
      availabilityStatus: String(form.get('availabilityStatus')) as FilamentSpool['availabilityStatus'],
      ...effects,
      ...(twoTone ? { secondaryColorName, secondaryColorHex: String(form.get('secondaryColorHex')) } : {}),
      notes: String(form.get('notes') || ''),
      updatedAt: Date.now(),
    };
    await adminSaveSpool(spool);
    setMessage('Spool and customer color availability added.');
    event.currentTarget.reset();
  }

  async function updateSpool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingSpool) return;
    const form = new FormData(event.currentTarget);
    const material = String(form.get('material')) as Material;
    const colorName = String(form.get('colorName')).trim();
    const twoTone = form.get('twoTone') === 'on';
    const secondaryColorName = twoTone ? String(form.get('secondaryColorName')).trim() : '';
    const effects = {
      glowInTheDark: form.get('glowInTheDark') === 'on',
      metallic: form.get('metallic') === 'on',
      transparent: form.get('transparent') === 'on',
      twoTone,
    };
    const purchaseDate = String(form.get('purchaseDate') || '');
    const expectedRestockDate = String(form.get('expectedRestockDate') || '');
    const notes = String(form.get('notes') || '').trim();
    const inheritedSettings = inventoryDefaults?.[material] ?? (material === 'PLA' ? fallbackInventorySettings : petgFallbackInventorySettings);
    const updatedSpool: FilamentSpool = {
      ...editingSpool,
      ...(editingSpool.material !== material && editingSpool.usesCustomInventorySettings !== true ? inheritedSettings : {}),
      material,
      colorId: buildSpoolColorId({ material, colorName, secondaryColorName, ...effects }),
      colorName,
      colorHex: String(form.get('colorHex')),
      startingWeightGrams: Number(form.get('startingWeightGrams')),
      currentPhysicalWeightGrams: Number(form.get('currentPhysicalWeightGrams')),
      availabilityStatus: String(form.get('availabilityStatus')) as FilamentSpool['availabilityStatus'],
      ...effects,
      updatedAt: Date.now(),
    };
    if (purchaseDate) updatedSpool.purchaseDate = purchaseDate; else delete updatedSpool.purchaseDate;
    if (expectedRestockDate) updatedSpool.expectedRestockDate = expectedRestockDate; else delete updatedSpool.expectedRestockDate;
    if (notes) updatedSpool.notes = notes; else delete updatedSpool.notes;
    if (twoTone) {
      updatedSpool.secondaryColorName = secondaryColorName;
      updatedSpool.secondaryColorHex = String(form.get('secondaryColorHex'));
    } else {
      delete updatedSpool.secondaryColorName;
      delete updatedSpool.secondaryColorHex;
    }
    await adminSaveSpool(updatedSpool);
    setEditingSpool(null);
    setMessage('Spool updated and customer availability recalculated.');
  }

  async function updateSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settingsSpool) return;
    const form = new FormData(event.currentTarget);
    const usesCustomInventorySettings = form.get('usesCustomInventorySettings') === 'on';
    const inheritedSettings = inventoryDefaults?.[settingsSpool.material] ?? (settingsSpool.material === 'PLA' ? fallbackInventorySettings : petgFallbackInventorySettings);
    await adminSaveSpool({
      ...settingsSpool,
      ...(usesCustomInventorySettings ? readInventorySettings(form) : inheritedSettings),
      usesCustomInventorySettings,
      updatedAt: Date.now(),
    });
    setSettingsSpool(null);
    setMessage('Inventory settings updated.');
  }

  async function updateMaterialDefaults(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!defaultSettingsMaterial) return;
    const form = new FormData(event.currentTarget);
    const forceAll = form.get('forceAll') === 'on';
    await adminSaveInventoryDefaults(defaultSettingsMaterial, readInventorySettings(form), forceAll);
    setDefaultSettingsMaterial(null);
    setMessage(forceAll ? `${defaultSettingsMaterial} defaults applied to every spool.` : `${defaultSettingsMaterial} defaults updated for all non-custom spools.`);
  }

  async function deleteSpool(spool: FilamentSpool) {
    if (!window.confirm(`Delete ${spool.colorName} ${spool.material} spool?`)) return;
    await adminDeleteSpool(spool);
    if (editingSpool?.id === spool.id) setEditingSpool(null);
    if (settingsSpool?.id === spool.id) setSettingsSpool(null);
    setMessage('Spool deleted and customer availability recalculated.');
  }

  async function rebuildPublicInventory() {
    if (!window.confirm('Rebuild all customer colors and separate effect variants?')) return;
    await adminRebuildPublicInventory();
    setMessage('Customer colors rebuilt. Effect variants are now separate.');
  }

  const list = objectValues(spools).sort((a, b) => a.material.localeCompare(b.material) || a.colorName.localeCompare(b.colorName));
  return (
    <Page title="Filament inventory">
      <form className="panel form-grid" onSubmit={addSpool}>
        <h2 className="field-full">Add spool</h2>
        <label>Material<select name="material"><option>PLA</option><option>PETG</option></select></label>
        <label>Color name<input name="colorName" required /></label>
        <label>Color<input name="colorHex" type="color" defaultValue="#000000" onChange={synchronizeColorName} /></label>
        <label className="checkbox-label"><input name="glowInTheDark" type="checkbox" /> Glow in the dark</label>
        <label className="checkbox-label"><input name="metallic" type="checkbox" /> Metallic</label>
        <label className="checkbox-label"><input name="transparent" type="checkbox" /> Transparent</label>
        <TwoToneFields />
        <QuickColorSelect />
        <label>Starting grams<SpoolSizeSelect defaultValue={1000} /></label>
        <label>Current grams<input name="currentPhysicalWeightGrams" type="number" min="0" defaultValue="1000" required /></label>
        <label>Status<select name="availabilityStatus"><option>Available</option><option>Low stock</option><option>Out of stock</option><option>Special order</option><option>Coming soon</option><option>Hidden</option><option>Discontinued</option></select></label>
        <label className="field-full">Notes<textarea name="notes" rows={3} /></label>
        {message && <div className="alert alert-success field-full">{message}</div>}
        <div className="field-full"><button className="button">Add spool</button></div>
      </form>
      <section className="panel">
        <div className="panel-heading"><h2>Material inventory defaults</h2><div className="button-row"><button className="button button-secondary" onClick={() => setDefaultSettingsMaterial('PLA')}>PLA settings</button><button className="button button-secondary" onClick={() => setDefaultSettingsMaterial('PETG')}>PETG settings</button><button className="button button-secondary" onClick={() => void rebuildPublicInventory()}>Rebuild customer colors</button></div></div>
      </section>
      <section className="panel"><h2>Current spools</h2><div className="table-wrap"><table><thead><tr><th>Material</th><th>Color</th><th>Type</th><th>Physical</th><th>Reserved</th><th>Available</th><th>Status</th><th></th></tr></thead>
        <tbody>{list.map((spool) => { const available = Math.max(0, spool.currentPhysicalWeightGrams - spool.reservedWeightGrams - spool.minimumReserveGrams); const colorStyle = spool.twoTone && spool.secondaryColorHex ? { background: `linear-gradient(135deg, ${spool.colorHex} 0 49%, ${spool.secondaryColorHex} 51% 100%)` } : { backgroundColor: spool.colorHex }; const effects = [spool.glowInTheDark ? 'Glow in the dark' : '', spool.metallic ? 'Metallic' : '', spool.transparent ? 'Transparent' : '', spool.twoTone ? 'Two-tone' : ''].filter(Boolean); return <tr key={spool.id}><td>{spool.material}</td><td><span className="mini-swatch" style={colorStyle} /> {spool.colorName}{spool.twoTone && spool.secondaryColorName ? ` + ${spool.secondaryColorName}` : ''}</td><td><div className="color-effects">{effects.length ? effects.map((effect) => <span className="status" key={effect}>{effect}</span>) : <span className="muted">Standard</span>}</div></td><td>{spool.currentPhysicalWeightGrams} g</td><td>{spool.reservedWeightGrams} g</td><td>{available} g</td><td><StatusBadge value={spool.availabilityStatus} /></td><td><div className="button-row"><button className="button button-secondary" onClick={() => { setEditingSpool(spool); setSettingsSpool(null); }}>Edit</button><button className="button button-secondary" onClick={() => { setSettingsSpool(spool); setEditingSpool(null); }}>Settings</button><button className="button button-danger" onClick={() => void deleteSpool(spool)}>Delete</button></div></td></tr>; })}</tbody>
      </table></div></section>
      {editingSpool && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingSpool(null); }}>
        <form key={editingSpool.id} className="modal-panel form-grid" role="dialog" aria-modal="true" aria-labelledby="edit-spool-title" onSubmit={updateSpool}>
          <h2 id="edit-spool-title" className="field-full">Edit spool: {editingSpool.colorName} {editingSpool.material}</h2>
          <label>Material<select name="material" defaultValue={editingSpool.material}><option>PLA</option><option>PETG</option></select></label>
          <label>Color name<input name="colorName" defaultValue={editingSpool.colorName} required autoFocus /></label>
          <label>Color<input name="colorHex" type="color" defaultValue={editingSpool.colorHex} onChange={synchronizeColorName} /></label>
          <label className="checkbox-label"><input name="glowInTheDark" type="checkbox" defaultChecked={editingSpool.glowInTheDark} /> Glow in the dark</label>
          <label className="checkbox-label"><input name="metallic" type="checkbox" defaultChecked={editingSpool.metallic} /> Metallic</label>
          <label className="checkbox-label"><input name="transparent" type="checkbox" defaultChecked={editingSpool.transparent} /> Transparent</label>
          <TwoToneFields spool={editingSpool} />
          <QuickColorSelect />
          <label>Starting grams<SpoolSizeSelect defaultValue={editingSpool.startingWeightGrams} /></label>
          <label>Current physical grams<input name="currentPhysicalWeightGrams" type="number" min="0" defaultValue={editingSpool.currentPhysicalWeightGrams} required /></label>
          <label>Status<select name="availabilityStatus" defaultValue={editingSpool.availabilityStatus}><option>Available</option><option>Low stock</option><option>Out of stock</option><option>Special order</option><option>Coming soon</option><option>Hidden</option><option>Discontinued</option></select></label>
          <label>Purchase date<input name="purchaseDate" type="date" defaultValue={editingSpool.purchaseDate} /></label>
          <label>Expected restock<input name="expectedRestockDate" type="date" defaultValue={editingSpool.expectedRestockDate} /></label>
          <label className="field-full">Notes<textarea name="notes" rows={3} defaultValue={editingSpool.notes} /></label>
          <div className="field-full button-row"><button className="button">Save spool</button><button className="button button-secondary" type="button" onClick={() => setEditingSpool(null)}>Cancel</button></div>
        </form>
      </div>}
      {settingsSpool && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsSpool(null); }}>
        <form key={settingsSpool.id} className="modal-panel form-grid" role="dialog" aria-modal="true" aria-labelledby="spool-settings-title" onSubmit={updateSettings}>
          <h2 id="spool-settings-title" className="field-full">Inventory settings: {settingsSpool.colorName} {settingsSpool.material}</h2>
          <label className="checkbox-label field-full"><input name="usesCustomInventorySettings" type="checkbox" defaultChecked={settingsSpool.usesCustomInventorySettings === true} autoFocus /> Use custom settings for this spool</label>
          <InventorySettingsFields material={settingsSpool.material} values={settingsSpool} />
          <div className="field-full button-row"><button className="button">Save settings</button><button className="button button-secondary" type="button" onClick={() => setSettingsSpool(null)}>Cancel</button></div>
        </form>
      </div>}
      {defaultSettingsMaterial && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDefaultSettingsMaterial(null); }}>
        <form key={defaultSettingsMaterial} className="modal-panel form-grid" role="dialog" aria-modal="true" aria-labelledby="material-settings-title" onSubmit={updateMaterialDefaults}>
          <h2 id="material-settings-title" className="field-full">{defaultSettingsMaterial} inventory defaults</h2>
          <InventorySettingsFields material={defaultSettingsMaterial} values={inventoryDefaults?.[defaultSettingsMaterial] ?? (defaultSettingsMaterial === 'PLA' ? fallbackInventorySettings : petgFallbackInventorySettings)} />
          <label className="checkbox-label field-full"><input name="forceAll" type="checkbox" /> Force update all spools and replace custom settings</label>
          <div className="field-full button-row"><button className="button">Apply to {defaultSettingsMaterial}</button><button className="button button-secondary" type="button" onClick={() => setDefaultSettingsMaterial(null)}>Cancel</button></div>
        </form>
      </div>}
    </Page>
  );
}

function readInventorySettings(form: FormData): InventorySettings {
  return {
    reservedWeightGrams: Number(form.get('reservedWeightGrams') || 0),
    minimumReserveGrams: Number(form.get('minimumReserveGrams') || 0),
    pricePerGramCents: Math.round(Number(form.get('pricePerGram') || 0) * 100),
    wasteAllowancePercent: Number(form.get('wasteAllowancePercent') || 0),
    reorderThresholdGrams: Number(form.get('reorderThresholdGrams') || 0),
    smallRateCents: Math.round(Number(form.get('smallRate') || 0) * 100),
    mediumRateCents: Math.round(Number(form.get('mediumRate') || 0) * 100),
    largeRateCents: Math.round(Number(form.get('largeRate') || 0) * 100),
    bulkRateCents: Math.round(Number(form.get('bulkRate') || 0) * 100),
  };
}

function InventorySettingsFields({ material, values }: { material: Material; values: Pick<InventorySettings, 'reservedWeightGrams' | 'minimumReserveGrams' | 'pricePerGramCents' | 'wasteAllowancePercent' | 'reorderThresholdGrams'> & Partial<Pick<InventorySettings, 'smallRateCents' | 'mediumRateCents' | 'largeRateCents' | 'bulkRateCents'>> }) {
  const defaultRates = material === 'PLA' ? fallbackInventorySettings : petgFallbackInventorySettings;
  return (
    <>
      <label>Reserved grams<input name="reservedWeightGrams" type="number" min="0" defaultValue={values.reservedWeightGrams} /></label>
      <label>Minimum reserve<input name="minimumReserveGrams" type="number" min="0" defaultValue={values.minimumReserveGrams} /></label>
      <label>Price per gram<input name="pricePerGram" type="number" min="0" step="0.01" defaultValue={values.pricePerGramCents / 100} /></label>
      <label>Waste allowance %<input name="wasteAllowancePercent" type="number" min="0" max="100" defaultValue={values.wasteAllowancePercent} /></label>
      <label>Reorder at grams<input name="reorderThresholdGrams" type="number" min="0" defaultValue={values.reorderThresholdGrams} /></label>
      <label>{material} 0g–50g rate<input name="smallRate" type="number" min="0" step="0.01" defaultValue={(values.smallRateCents ?? defaultRates.smallRateCents) / 100} /></label>
      <label>{material} 51g–200g rate<input name="mediumRate" type="number" min="0" step="0.01" defaultValue={(values.mediumRateCents ?? defaultRates.mediumRateCents) / 100} /></label>
      <label>{material} 201g–499g rate<input name="largeRate" type="number" min="0" step="0.01" defaultValue={(values.largeRateCents ?? defaultRates.largeRateCents) / 100} /></label>
      <label>{material} 500g+ (Bulk) rate<input name="bulkRate" type="number" min="0" step="0.01" defaultValue={(values.bulkRateCents ?? defaultRates.bulkRateCents) / 100} /></label>
    </>
  );
}

function QuickColorSelect({ nameField = 'colorName', hexField = 'colorHex' }: { nameField?: string; hexField?: string }) {
  function selectColor(event: React.MouseEvent<HTMLButtonElement>, name: string, hex: string) {
    const form = event.currentTarget.closest('form');
    const colorName = form?.elements.namedItem(nameField);
    const colorHex = form?.elements.namedItem(hexField);
    if (colorName instanceof HTMLInputElement) {
      colorName.value = name;
      colorName.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (colorHex instanceof HTMLInputElement) {
      colorHex.value = hex;
      colorHex.dispatchEvent(new Event('input', { bubbles: true }));
      colorHex.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  return (
    <fieldset className="quick-colors field-full">
      <legend>Quick select</legend>
      <div className="quick-color-grid">
        {quickColors.map((color) => (
          <button
            key={color.name}
            type="button"
            className="quick-color"
            title={color.name}
            aria-label={`Select ${color.name}`}
            onClick={(event) => selectColor(event, color.name, color.hex)}
          >
            <span style={{ backgroundColor: color.hex }} />
            {color.name}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function TwoToneFields({ spool }: { spool?: FilamentSpool }) {
  const [enabled, setEnabled] = useState(spool?.twoTone === true);
  function synchronizeSecondaryColorName(event: React.ChangeEvent<HTMLInputElement>) {
    const hex = event.currentTarget.value.toUpperCase();
    const colorName = event.currentTarget.form?.elements.namedItem('secondaryColorName');
    if (colorName instanceof HTMLInputElement) {
      colorName.value = quickColors.find((color) => color.hex === hex)?.name ?? `Custom ${hex}`;
    }
  }
  return (
    <>
      <label className="checkbox-label"><input name="twoTone" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Two-tone</label>
      {enabled && <div className="two-tone-fields field-full">
        <label>Second color name<input name="secondaryColorName" defaultValue={spool?.secondaryColorName} required /></label>
        <label>Second color<input name="secondaryColorHex" type="color" defaultValue={spool?.secondaryColorHex ?? '#ffffff'} onChange={synchronizeSecondaryColorName} /></label>
        <QuickColorSelect nameField="secondaryColorName" hexField="secondaryColorHex" />
      </div>}
    </>
  );
}

function SpoolSizeSelect({ defaultValue }: { defaultValue: number }) {
  const hasStandardValue = standardSpoolSizes.some((size) => size === defaultValue);
  return (
    <select name="startingWeightGrams" defaultValue={defaultValue} required>
      {!hasStandardValue && <option value={defaultValue}>{defaultValue.toLocaleString()} g (current)</option>}
      {standardSpoolSizes.map((size) => <option key={size} value={size}>{size.toLocaleString()} g</option>)}
    </select>
  );
}

export function AdminCustomersPage() {
  const { user } = useAuth();
  const { data: profiles, loading: profilesLoading, error: profilesError } = useRealtimeValue<Record<string, UserProfile>>('userProfiles');
  const { data: ledgers, error: ledgersError } = useRealtimeValue<Record<string, FinancialLedger>>('financialLedgers');
  const { data: orderMap } = useRealtimeValue<Record<string, Order>>('orders');
  const [selected, setSelected] = useState<UserProfile | null>(null);
  const [customerTab, setCustomerTab] = useState<'info' | 'requested' | 'completed' | 'receipts'>('info');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!selected) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [selected]);

  async function recordTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !user) return;
    const form = new FormData(event.currentTarget);
    const type = String(form.get('type')) as BalanceTransaction['type'];
    const entered = Math.round(Number(form.get('amount')) * 100);
    const creditTypes: BalanceTransaction['type'][] = ['Cash payment','Card payment in person','Check payment','Deposit','Discount','Customer credit'];
    const amountCents = creditTypes.includes(type) ? Math.abs(entered) : -Math.abs(entered);
    await adminRecordBalanceTransaction(selected.uid, {
      orderId: String(form.get('orderId') || ''),
      type,
      amountCents,
      description: String(form.get('description')),
      paymentMethod: String(form.get('paymentMethod') || 'Other') as BalanceTransaction['paymentMethod'],
      adminId: user.uid,
      receiptNumber: String(form.get('receiptNumber') || ''),
      internalNote: String(form.get('internalNote') || ''),
    });
    setMessage('Transaction recorded.');
    event.currentTarget.reset();
  }

  async function adjustBalance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !user || !ledgers?.[selected.uid]) return;
    const form = new FormData(event.currentTarget);
    const amountCents = Math.round(Number(form.get('adjustment')) * 100);
    if (!amountCents) return;
    await adminRecordBalanceTransaction(selected.uid, {
      orderId: '',
      type: 'Manual correction',
      amountCents,
      description: String(form.get('reason')).trim(),
      paymentMethod: 'Other',
      adminId: user.uid,
      receiptNumber: '',
      internalNote: 'Signed balance adjustment',
    });
    setMessage('Balance adjusted.');
    event.currentTarget.reset();
  }

  const customers = objectValues(profiles)
    .filter((profile) => profile.uid !== user?.uid)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const selectedOrders = objectValues(orderMap).filter((order) => order.customerId === selected?.uid).sort((a, b) => b.createdAt - a.createdAt);
  const requestedOrders = selectedOrders.filter((order) => !['Completed', 'Cancelled'].includes(order.status));
  const completedOrders = selectedOrders.filter((order) => order.status === 'Completed');
  const selectedLedger = selected ? ledgers?.[selected.uid] : undefined;
  const receipts = objectValues(selectedLedger?.transactions).sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Page title="Customers and balances">
      {profilesError && <div className="alert alert-error">Customers could not be loaded: {profilesError}</div>}
      {ledgersError && <div className="alert alert-error">Balances could not be loaded: {ledgersError}</div>}
      <section className="panel"><div className="table-wrap"><table><thead><tr><th>Customer</th><th>Email</th><th>Status</th><th>Balance</th><th></th></tr></thead>
        <tbody>{customers.map((customer) => <tr key={customer.uid}><td>{customer.displayName}</td><td>{customer.email}</td><td><StatusBadge value={customer.accountStatus} /></td><td>{formatMoney(normalizedBalanceCents(ledgers?.[customer.uid]?.summary))}</td><td><button className="button button-secondary" onClick={() => { setSelected(customer); setCustomerTab('info'); setMessage(''); }}>Manage</button></td></tr>)}</tbody>
      </table></div></section>
      {!profilesLoading && !profilesError && customers.length === 0 && <p className="muted">No customer accounts were found.</p>}
      {selected && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
        <section className="modal-panel customer-modal" role="dialog" aria-modal="true" aria-labelledby="customer-modal-title">
          <div className="panel-heading"><div><h2 id="customer-modal-title">{selected.displayName}</h2><span className="muted">{selected.email}</span></div><button className="icon-button" onClick={() => setSelected(null)} aria-label="Close">×</button></div>
          <div className="customer-tabs" role="tablist" aria-label="Customer details">
            {([['info', 'Info'], ['requested', `Requested (${requestedOrders.length})`], ['completed', `Completed (${completedOrders.length})`], ['receipts', `Receipts (${receipts.length})`]] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={customerTab === id} className={customerTab === id ? 'active' : ''} onClick={() => setCustomerTab(id)}>{label}</button>)}
          </div>
          {message && <div className="alert alert-success">{message}</div>}
          {customerTab === 'info' && <div className="customer-tab-content">
            <dl className="details-list"><dt>Name</dt><dd>{selected.firstName || selected.lastName ? `${selected.firstName ?? ''} ${selected.lastName ?? ''}`.trim() : selected.displayName}</dd><dt>Email</dt><dd>{selected.email}</dd><dt>Phone</dt><dd>{selected.phone || 'Not set'}</dd><dt>Preferred contact</dt><dd>{selected.preferredContact || 'Not set'}</dd><dt>Pickup preference</dt><dd>{selected.pickupPreference ? 'Local pickup' : 'Not specified'}</dd><dt>Shipping address</dt><dd>{selected.shippingAddress || 'Not set'}</dd><dt>Account status</dt><dd><StatusBadge value={selected.accountStatus} /></dd><dt>Joined</dt><dd>{formatDate(selected.createdAt)}</dd><dt>Current balance</dt><dd>{formatMoney(normalizedBalanceCents(selectedLedger?.summary))}</dd></dl>
            {selectedLedger && <form className="form-grid customer-subsection" onSubmit={adjustBalance}><h3 className="field-full">Adjust balance</h3><label>Signed adjustment (+ credit / - owed)<input name="adjustment" type="number" step="0.01" placeholder="+25.00 or -10.00" required /></label><label>Reason<input name="reason" required /></label><div className="field-full"><button className="button">Apply adjustment</button></div></form>}
            <form className="form-grid customer-subsection" onSubmit={recordTransaction}><h3 className="field-full">Record transaction</h3><label>Type<select name="type"><option>Order charge</option><option>Additional charge</option><option>Cash payment</option><option>Card payment in person</option><option>Check payment</option><option>Deposit</option><option>Discount</option><option>Refund</option><option>Customer credit</option><option>Manual correction</option></select></label><label>Amount<input name="amount" type="number" min="0" step="0.01" required /></label><label>Order ID<input name="orderId" /></label><label>Payment method<select name="paymentMethod"><option>Cash</option><option>Card paid in person</option><option>Check</option><option>Other</option></select></label><label>Receipt number<input name="receiptNumber" /></label><label>Description<input name="description" required /></label><label className="field-full">Internal note<textarea name="internalNote" rows={2} /></label><div className="field-full"><button className="button">Record transaction</button></div></form>
          </div>}
          {customerTab === 'requested' && <CustomerOrderHistory orders={requestedOrders} empty="No active print requests." />}
          {customerTab === 'completed' && <CustomerOrderHistory orders={completedOrders} empty="No completed prints." />}
          {customerTab === 'receipts' && <div className="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Receipt</th><th>Amount</th></tr></thead><tbody>{receipts.map((item) => <tr key={item.id}><td>{formatDate(item.createdAt)}</td><td>{item.type}</td><td>{item.description}</td><td>{item.receiptNumber || '—'}</td><td>{formatMoney(selectedLedger?.summary.signConvention === 'credit-positive' ? item.amountCents : -item.amountCents)}</td></tr>)}</tbody></table>{receipts.length === 0 && <p className="muted">No receipts or transactions.</p>}</div>}
        </section>
      </div>}
    </Page>
  );
}

function CustomerOrderHistory({ orders, empty }: { orders: Order[]; empty: string }) {
  if (orders.length === 0) return <p className="muted customer-tab-content">{empty}</p>;
  return <div className="table-wrap customer-tab-content"><table><thead><tr><th>Order</th><th>Model</th><th>Material</th><th>Status</th><th>Submitted</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><Link to={`/orders/${order.id}`}>{order.orderNumber}</Link></td><td>{order.modelName}</td><td>{order.material} · {order.colorName}</td><td><StatusBadge value={order.status} /></td><td>{formatDate(order.createdAt)}</td></tr>)}</tbody></table></div>;
}

export function AdminColorRequestsPage() {
  const { data: requests } = useRealtimeValue<Record<string, ColorRequest>>('colorRequests');
  async function changeStatus(request: ColorRequest, status: ColorRequest['status']) {
    await update(ref(db), {
      [`colorRequests/${request.id}/status`]: status,
      [`colorRequests/${request.id}/updatedAt`]: Date.now(),
    });
  }
  const list = objectValues(requests).sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Page title="Requested colors">
      <section className="panel"><div className="table-wrap"><table><thead><tr><th>Customer</th><th>Material</th><th>Color</th><th>Status</th><th>Submitted</th><th>Action</th></tr></thead>
        <tbody>{list.map((request) => <tr key={request.id}><td>{request.customerName}</td><td>{request.material}</td><td>{request.requestedColorName}</td><td><StatusBadge value={request.status} /></td><td>{formatDate(request.createdAt)}</td><td><select value={request.status} onChange={(e) => void changeStatus(request, e.target.value as ColorRequest['status'])}><option>Submitted</option><option>Reviewing</option><option>Waiting for customer</option><option>Approved</option><option>Declined</option><option>Alternative suggested</option><option>Waiting for payment</option><option>Payment confirmed</option><option>Ordered</option><option>Arrived</option><option>Added to inventory</option><option>Customer notified</option><option>Completed</option><option>Cancelled</option></select></td></tr>)}</tbody>
      </table></div></section>
    </Page>
  );
}


export function AdminPrintersPage() {
  const { data: printers } = useRealtimeValue<Record<string, Printer>>('printers');
  const [message, setMessage] = useState('');

  async function addPrinter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const printerRef = push(ref(db, 'printers'));
    if (!printerRef.key) return;
    const supportedMaterials = form.getAll('supportedMaterials') as Material[];
    const printer: Printer = {
      id: printerRef.key,
      name: String(form.get('name')),
      model: String(form.get('model')),
      buildWidthMm: Number(form.get('buildWidthMm')),
      buildDepthMm: Number(form.get('buildDepthMm')),
      buildHeightMm: Number(form.get('buildHeightMm')),
      supportedMaterials: supportedMaterials.length ? supportedMaterials : ['PLA', 'PETG'],
      nozzleSizeMm: Number(form.get('nozzleSizeMm')),
      status: 'Available',
      lastMaintenanceDate: String(form.get('lastMaintenanceDate') || ''),
      nextMaintenanceDate: String(form.get('nextMaintenanceDate') || ''),
      notes: String(form.get('notes') || ''),
      updatedAt: Date.now(),
    };
    await set(printerRef, printer);
    setMessage('Printer added.');
    event.currentTarget.reset();
  }

  async function setPrinterStatus(printer: Printer, status: Printer['status']) {
    await update(ref(db), {
      [`printers/${printer.id}/status`]: status,
      [`printers/${printer.id}/updatedAt`]: Date.now(),
    });
  }

  const list = objectValues(printers).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Page title="Printers">
      <form className="panel form-grid" onSubmit={addPrinter}>
        <h2 className="field-full">Add printer</h2>
        <label>Name<input name="name" required /></label>
        <label>Model<input name="model" required /></label>
        <label>Build width mm<input name="buildWidthMm" type="number" min="1" required /></label>
        <label>Build depth mm<input name="buildDepthMm" type="number" min="1" required /></label>
        <label>Build height mm<input name="buildHeightMm" type="number" min="1" required /></label>
        <label>Nozzle size mm<input name="nozzleSizeMm" type="number" min="0.1" step="0.1" defaultValue="0.4" required /></label>
        <label className="checkbox-label"><input name="supportedMaterials" type="checkbox" value="PLA" defaultChecked /> PLA</label>
        <label className="checkbox-label"><input name="supportedMaterials" type="checkbox" value="PETG" defaultChecked /> PETG</label>
        <label>Last maintenance<input name="lastMaintenanceDate" type="date" /></label>
        <label>Next maintenance<input name="nextMaintenanceDate" type="date" /></label>
        <label className="field-full">Notes<textarea name="notes" rows={3} /></label>
        {message && <div className="alert alert-success field-full">{message}</div>}
        <div className="field-full"><button className="button">Add printer</button></div>
      </form>

      <section className="panel">
        <h2>Printer list</h2>
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Model</th><th>Build volume</th><th>Materials</th><th>Nozzle</th><th>Status</th></tr></thead>
          <tbody>{list.map((printer) => <tr key={printer.id}><td>{printer.name}</td><td>{printer.model}</td><td>{printer.buildWidthMm} × {printer.buildDepthMm} × {printer.buildHeightMm} mm</td><td>{printer.supportedMaterials.join(', ')}</td><td>{printer.nozzleSizeMm} mm</td><td><select value={printer.status} onChange={(e) => void setPrinterStatus(printer, e.target.value as Printer['status'])}><option>Available</option><option>Printing</option><option>Paused</option><option>Maintenance</option><option>Offline</option><option>Error</option></select></td></tr>)}</tbody>
        </table></div>
      </section>
    </Page>
  );
}

export function AdminPrintQueuePage() {
  const { data: queueMap } = useRealtimeValue<Record<string, PrintQueueItem>>('printQueue');
  const { data: orderMap } = useRealtimeValue<Record<string, Order>>('orders');
  const { data: printerMap } = useRealtimeValue<Record<string, Printer>>('printers');
  const queue = objectValues(queueMap).sort((a, b) => a.queuePosition - b.queuePosition);
  const orders = objectValues(orderMap).filter((order) => !['Completed', 'Cancelled'].includes(order.status));
  const printers = objectValues(printerMap);

  useEffect(() => {
    const missingOrders = orders.filter((order) => order.status === 'Queued' && !queue.some((item) => item.orderId === order.id));
    if (missingOrders.length === 0) return;
    let cancelled = false;
    async function createMissingJobs() {
      let nextPosition = queue.length ? Math.max(...queue.map((item) => item.queuePosition)) + 1 : 1;
      for (const order of missingOrders) {
        if (cancelled) return;
        const jobRef = push(ref(db, 'printQueue'));
        if (!jobRef.key) continue;
        const now = Date.now();
        const job: PrintQueueItem = {
          id: jobRef.key,
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          modelName: order.modelName,
          material: order.material,
          colorName: order.colorName,
          quantity: order.quantity,
          estimatedPrintHours: order.estimatedPrintHours ?? 0,
          estimatedFilamentGrams: order.estimatedFilamentGrams ?? 0,
          queuePosition: nextPosition,
          priority: 'Normal',
          deadline: order.requestedCompletionDate,
          paymentStatus: order.paymentStatus,
          status: 'Queued',
          createdAt: now,
          updatedAt: now,
        };
        await update(ref(db), {
          [`printQueue/${job.id}`]: job,
          [`orders/${order.id}/queuePosition`]: nextPosition,
          [`orders/${order.id}/queuedAt`]: now,
          [`orders/${order.id}/updatedAt`]: now,
        });
        nextPosition += 1;
      }
    }
    void createMissingJobs();
    return () => { cancelled = true; };
  }, [orderMap, queueMap]);

  async function addJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const order = orders.find((item) => item.id === String(form.get('orderId')));
    if (!order) return;
    const printer = printers.find((item) => item.id === String(form.get('printerId')));
    const jobRef = push(ref(db, 'printQueue'));
    if (!jobRef.key) return;
    const now = Date.now();
    const job: PrintQueueItem = {
      id: jobRef.key,
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      modelName: order.modelName,
      material: order.material,
      colorName: order.colorName,
      quantity: order.quantity,
      estimatedPrintHours: Number(form.get('estimatedPrintHours') || order.estimatedPrintHours || 0),
      estimatedFilamentGrams: Number(form.get('estimatedFilamentGrams') || order.estimatedFilamentGrams || 0),
      printerId: printer?.id,
      printerName: printer?.name,
      queuePosition: queue.length ? Math.max(...queue.map((item) => item.queuePosition)) + 1 : 1,
      priority: String(form.get('priority')) as PrintQueueItem['priority'],
      deadline: String(form.get('deadline') || order.requestedCompletionDate || ''),
      paymentStatus: order.paymentStatus,
      status: 'Queued',
      createdAt: now,
      updatedAt: now,
    };
    await update(ref(db), {
      [`printQueue/${job.id}`]: job,
      [`orders/${order.id}/status`]: 'Queued',
      [`orders/${order.id}/queuePosition`]: job.queuePosition,
      [`orders/${order.id}/queuedAt`]: now,
      [`orders/${order.id}/updatedAt`]: now,
    });
    event.currentTarget.reset();
  }

  async function move(item: PrintQueueItem, direction: -1 | 1) {
    const index = queue.findIndex((entry) => entry.id === item.id);
    const other = queue[index + direction];
    if (!other) return;
    await update(ref(db), {
      [`printQueue/${item.id}/queuePosition`]: other.queuePosition,
      [`printQueue/${other.id}/queuePosition`]: item.queuePosition,
      [`orders/${item.orderId}/queuePosition`]: other.queuePosition,
      [`orders/${other.orderId}/queuePosition`]: item.queuePosition,
      [`printQueue/${item.id}/updatedAt`]: Date.now(),
      [`printQueue/${other.id}/updatedAt`]: Date.now(),
    });
  }

  async function changeJob(item: PrintQueueItem, status: PrintQueueItem['status']) {
    const orderStatus: OrderStatus = status === 'Printing' ? 'Printing' : status === 'Paused' ? 'Paused' : status === 'Failed' ? 'Failed' : status === 'Completed' ? 'Post-processing' : status === 'Cancelled' ? 'Cancelled' : 'Queued';
    const updates: Record<string, unknown> = {
      [`printQueue/${item.id}/status`]: status,
      [`printQueue/${item.id}/updatedAt`]: Date.now(),
      [`orders/${item.orderId}/status`]: orderStatus,
      [`orders/${item.orderId}/updatedAt`]: Date.now(),
    };
    if (item.printerId) {
      updates[`printers/${item.printerId}/status`] = status === 'Printing' ? 'Printing' : status === 'Paused' ? 'Paused' : 'Available';
      updates[`printers/${item.printerId}/currentOrderId`] = status === 'Printing' || status === 'Paused' ? item.orderId : null;
      updates[`printers/${item.printerId}/updatedAt`] = Date.now();
    }
    await update(ref(db), updates);
  }

  return (
    <Page title="Print queue">
      <form className="panel form-grid" onSubmit={addJob}>
        <h2 className="field-full">Add order to queue</h2>
        <label>Order<select name="orderId" required><option value="">Select order</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.orderNumber} · {order.modelName}</option>)}</select></label>
        <label>Printer<select name="printerId"><option value="">Unassigned</option>{printers.map((printer) => <option key={printer.id} value={printer.id}>{printer.name} · {printer.status}</option>)}</select></label>
        <label>Estimated hours<input name="estimatedPrintHours" type="number" min="0" step="0.1" /></label>
        <label>Estimated grams<input name="estimatedFilamentGrams" type="number" min="0" /></label>
        <label>Priority<select name="priority" defaultValue="Normal"><option>Low</option><option>Normal</option><option>High</option><option>Urgent</option></select></label>
        <label>Deadline<input name="deadline" type="date" /></label>
        <div className="field-full"><button className="button">Add to queue</button></div>
      </form>

      <section className="panel">
        <h2>Queued jobs</h2>
        <div className="table-wrap"><table><thead><tr><th>Position</th><th>Order</th><th>Customer</th><th>Print</th><th>Printer</th><th>Estimate</th><th>Priority</th><th>Status</th><th>Move</th></tr></thead>
          <tbody>{queue.map((item, index) => <tr key={item.id}><td>{item.queuePosition}</td><td>{item.orderNumber}</td><td>{item.customerName}</td><td>{item.modelName}<br/><small>{item.material} · {item.colorName}</small></td><td>{item.printerName || 'Unassigned'}</td><td>{item.estimatedPrintHours} h<br/>{item.estimatedFilamentGrams} g</td><td><StatusBadge value={item.priority} /></td><td><select value={item.status} onChange={(e) => void changeJob(item, e.target.value as PrintQueueItem['status'])}><option>Queued</option><option>Preparing</option><option>Printing</option><option>Paused</option><option>Failed</option><option>Completed</option><option>Cancelled</option></select></td><td><div className="button-row"><button className="button button-secondary icon-button" disabled={index === 0} onClick={() => void move(item, -1)} aria-label="Move up">↑</button><button className="button button-secondary icon-button" disabled={index === queue.length - 1} onClick={() => void move(item, 1)} aria-label="Move down">↓</button></div></td></tr>)}</tbody>
        </table></div>
      </section>
    </Page>
  );
}

export function AdminReportsPage() {
  const { data: orderMap } = useRealtimeValue<Record<string, Order>>('orders');
  const { data: spoolMap } = useRealtimeValue<Record<string, FilamentSpool>>('filamentSpools');
  const { data: ledgers } = useRealtimeValue<Record<string, FinancialLedger>>('financialLedgers');
  const orders = objectValues(orderMap);
  const spools = objectValues(spoolMap);
  const totalOwed = objectValues(ledgers).reduce((sum, ledger) => sum + Math.max(0, -normalizedBalanceCents(ledger.summary)), 0);
  const totalCredit = objectValues(ledgers).reduce((sum, ledger) => sum + Math.max(0, normalizedBalanceCents(ledger.summary)), 0);
  const plaAvailable = spools.filter((item) => item.material === 'PLA').reduce((sum, item) => sum + Math.max(0, item.currentPhysicalWeightGrams - item.reservedWeightGrams - item.minimumReserveGrams), 0);
  const petgAvailable = spools.filter((item) => item.material === 'PETG').reduce((sum, item) => sum + Math.max(0, item.currentPhysicalWeightGrams - item.reservedWeightGrams - item.minimumReserveGrams), 0);
  const byStatus = orderStatuses.map((status) => ({ status, count: orders.filter((order) => order.status === status).length })).filter((item) => item.count > 0);

  return (
    <Page title="Reports">
      <div className="stat-grid">
        <Stat label="Orders" value={String(orders.length)} />
        <Stat label="Completed" value={String(orders.filter((order) => order.status === 'Completed').length)} />
        <Stat label="Customer balances due" value={formatMoney(totalOwed)} />
        <Stat label="Customer credit" value={formatMoney(totalCredit)} />
        <Stat label="PLA available" value={`${plaAvailable} g`} />
        <Stat label="PETG available" value={`${petgAvailable} g`} />
      </div>
      <section className="panel"><h2>Orders by status</h2><div className="report-bars">{byStatus.map((item) => <div className="report-row" key={item.status}><span>{item.status}</span><progress max={Math.max(1, orders.length)} value={item.count} /><strong>{item.count}</strong></div>)}</div></section>
      <section className="panel"><h2>Material demand</h2><table><thead><tr><th>Material</th><th>Orders</th><th>Estimated filament</th></tr></thead><tbody><tr><td>PLA</td><td>{orders.filter((order) => order.material === 'PLA').length}</td><td>{orders.filter((order) => order.material === 'PLA').reduce((sum, order) => sum + (order.estimatedFilamentGrams ?? 0), 0)} g</td></tr><tr><td>PETG</td><td>{orders.filter((order) => order.material === 'PETG').length}</td><td>{orders.filter((order) => order.material === 'PETG').reduce((sum, order) => sum + (order.estimatedFilamentGrams ?? 0), 0)} g</td></tr></tbody></table></section>
    </Page>
  );
}

export function AdminImagesPage() {
  const { user } = useAuth();
  const { data: imageMap, loading } = useRealtimeValue<Record<string, SharedImage>>('adminImages');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const images = objectValues(imageMap).sort((a, b) => b.createdAt - a.createdAt);

  async function uploadImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get('image');
    if (!(file instanceof File) || file.size === 0) {
      setError('Choose an image to upload.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const imageData = await imageFileToBase64(file);
      await adminUploadImage({
        title: String(form.get('title')).trim(),
        description: String(form.get('description') || '').trim(),
        fileName: file.name,
        mimeType: file.type as SharedImage['mimeType'],
        imageData,
      }, user.uid, form.get('shareNow') === 'on');
      formElement.reset();
      setMessage('Image uploaded.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to upload image.');
    } finally {
      setBusy(false);
    }
  }

  async function setShared(image: SharedImage, isShared: boolean) {
    setError('');
    try {
      await adminSetImageShared(image, isShared);
      setMessage(isShared ? 'Image shared with customers.' : 'Image is now private.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update sharing.');
    }
  }

  async function removeImage(image: SharedImage) {
    if (!window.confirm(`Delete “${image.title}”?`)) return;
    setError('');
    try {
      await adminDeleteImage(image.id);
      setMessage('Image deleted.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to delete image.');
    }
  }

  return (
    <Page title="Image sharing" intro="Upload images to Firebase and choose which ones customers can see.">
      <form className="panel form-grid" onSubmit={uploadImage}>
        <h2 className="field-full">Upload image</h2>
        <label>Title<input name="title" required maxLength={120} /></label>
        <label>Image<input name="image" type="file" accept="image/jpeg,image/png,image/webp" required /></label>
        <label className="field-full">Description<textarea name="description" rows={3} maxLength={500} /></label>
        <label className="checkbox-label field-full"><input name="shareNow" type="checkbox" /> Share with customers immediately</label>
        {error && <div className="alert alert-error field-full">{error}</div>}
        {message && <div className="alert alert-success field-full">{message}</div>}
        <div className="field-full"><button className="button" disabled={busy}>{busy ? 'Uploading…' : 'Upload image'}</button></div>
      </form>

      <section className="panel">
        <h2>Image library</h2>
        {loading ? <Loading /> : images.length === 0 ? <p className="muted">No images uploaded.</p> : (
          <div className="image-gallery">
            {images.map((image) => (
              <article className="image-card" key={image.id}>
                <img src={image.imageData} alt={image.title} />
                <div className="image-card-body">
                  <div className="image-card-heading"><strong>{image.title}</strong><StatusBadge value={image.isShared ? 'Shared' : 'Private'} /></div>
                  {image.description && <p>{image.description}</p>}
                  <small>{image.fileName} · {formatDate(image.createdAt)}</small>
                  <div className="button-row">
                    <button className="button button-secondary" onClick={() => void setShared(image, !image.isShared)}>{image.isShared ? 'Make private' : 'Share'}</button>
                    <button className="button button-danger" onClick={() => void removeImage(image)}>Delete</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </Page>
  );
}

function AdminOrderTable({ orders, onSelect }: { orders: Order[]; onSelect?: (order: Order) => void }) {
  if (orders.length === 0) return <p className="muted">No matching orders.</p>;
  return <div className="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Model</th><th>Material / colors</th><th>Status</th><th>Queue</th><th>Submitted</th><th>Payment</th><th></th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><Link to={`/orders/${order.id}`}>{order.orderNumber}</Link></td><td>{order.customerName}</td><td>{order.modelName}</td><td>{order.material} · {order.multiColor && order.selectedColors ? order.selectedColors.map((color) => color.name).join(' + ') : order.colorName}</td><td><StatusBadge value={order.status} /></td><td>{order.queuePosition ? `#${order.queuePosition}` : '—'}</td><td>{formatDate(order.createdAt)}</td><td><StatusBadge value={order.paymentStatus} /></td><td>{onSelect && <button className="button button-secondary" onClick={() => onSelect(order)}>Edit</button>}</td></tr>)}</tbody></table></div>;
}

function Stat({ label, value }: { label: string; value: string }) { return <article className="stat"><span>{label}</span><strong>{value}</strong></article>; }
function Page({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) { return <><header className="page-heading"><h1>{title}</h1>{intro && <p>{intro}</p>}</header>{children}</>; }
