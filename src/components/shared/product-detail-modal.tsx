'use client';

import * as React from 'react';
import { ImageIcon, Upload } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useApi, useCategories } from '@/data/db';
import type { Product } from '@/data/types';
import { postJson, errMsg, isStale, uploadFile, fileUrl } from '@/lib/api';
import { useFormErrors, useClearOnChange } from '@/lib/use-form-errors';
import { useAccess } from '@/lib/use-access';
import { productSchema } from '@/lib/validation/admin';
import {
  type ProductForm as Form,
  EMPTY_PRODUCT_FORM as EMPTY_FORM,
  productFormOf,
} from '@/components/stock/product-form';
import {
  type StockCardRow as Card,
  ProductColorStatus,
  ProductFields,
  ProductLegacyNotes,
  ProductModelChecklist,
  ProductStockTables,
} from '@/components/stock/product-sections';

export type ProductMode = 'view' | 'edit' | 'add';

/** `version`: what the save sends back — another save of this product since it loaded → 409 */
type Detail = Product & { models: string[]; version?: number };

const NEW_PRODUCT: Product = {
  sysCode: '',
  mfgCode: '',
  name: '',
  category: '',
  brand: '',
  onhand: 0,
  price: 0,
  status: 'Active',
};

export function ProductDetailModal({
  open,
  onClose,
  product,
  mode,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  product: Product | null;
  mode: ProductMode;
  onSave?: (saved: Product) => void;
}) {
  const { push } = useToast();
  const { data: CATEGORIES } = useCategories(); // a new part starts in the first หมวดหมู่
  // ราคาทุน: Product Cost only — the API leaves it out for everyone else, so hide the field too
  const seeCost = useAccess().has('Product Cost');

  const ro = mode === 'view';
  const code = product?.sysCode ?? '';

  // full detail + stock card from the DB (product / product_none_serial / inventory_*)
  // by the part's uuid (ADR 0008) — the code stays what the dialog shows and saves by
  const detailKey = open && mode !== 'add' && product?.id ? `/api/products/${product.id}` : null;
  const loaded = useApi<{ product: Detail; card: Card[] }>(detailKey, {
    fresh: true,
    onError: (msg) => push({ kind: 'error', title: 'โหลดข้อมูลอะไหล่ไม่สำเร็จ', desc: msg }),
  });
  const detail = detailKey ? (loaded.data?.product ?? null) : null;
  const stockCard = React.useMemo(() => (detailKey ? (loaded.data?.card ?? []) : []), [detailKey, loaded.data]);
  const [form, setForm] = React.useState<Form>(EMPTY_FORM);
  const [saving, setSaving] = React.useState(false);
  const [image, setImage] = React.useState('');
  const [brokenImage, setBrokenImage] = React.useState(''); // the file that failed to load → placeholder
  const [modelQ, setModelQ] = React.useState('');
  const [allBrands, setAllBrands] = React.useState(false); // รุ่นสินค้า: only the chosen ยี่ห้อ's models unless ticked
  const [uploading, setUploading] = React.useState(false);

  // รูปอะไหล่ → bucket oneservice/products/{code}/… แล้วเก็บชื่อไฟล์ใน product.pictrue_file_name
  const onPickImage = async (f: File | undefined) => {
    if (!f || !code) return;
    setUploading(true);
    try {
      const d = await uploadFile('product-image', code, f);
      setImage(d.path);
      push({ kind: 'success', title: 'อัปโหลดรูปแล้ว', desc: f.name });
    } catch (e) {
      push({ kind: 'error', title: 'อัปโหลดรูปไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setUploading(false);
    }
  };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const fe = useFormErrors();
  useClearOnChange(fe.clear, form);

  // one dialog session = opened for one product (or "add"); state is adjusted while rendering:
  //  - a new session starts clean (no leftover errors, empty form for "add")
  //  - the edit form is filled ONCE per session, from a fresh answer (not a cached one still being
  //    re-read) — a late answer never overwrites what the user has started typing
  const session = `${open ? 1 : 0}|${mode}|${code}`;
  const [seenSession, setSeenSession] = React.useState('');
  const [filledFor, setFilledFor] = React.useState('');
  // the version of the answer the form was filled from (a later re-read must not move it: the save
  // would then claim to be based on values the form never showed)
  const [version, setVersion] = React.useState<number>();
  if (open && seenSession !== session) {
    setSeenSession(session);
    fe.setErrors({});
    setModelQ('');
    setAllBrands(false);
    if (mode === 'add' || !code) {
      setImage('');
      // ยี่ห้อ starts empty: defaulting to the first one (70mai) saved parts under the wrong brand
      setForm({ ...EMPTY_FORM, category: CATEGORIES[0]?.name ?? '' });
    }
  }
  if (detailKey && loaded.data && !loaded.validating && filledFor !== session) {
    const d = loaded.data;
    setFilledFor(session);
    setVersion(d.product.version);
    setImage(d.product.image ?? '');
    setForm(productFormOf(d.product));
  }
  if (!open && (filledFor || seenSession)) {
    // closed → the next open (even of the same product) starts a new session
    setFilledFor('');
    setSeenSession('');
  }

  const save = async () => {
    // the API checks the same; the vendor code the product already has (legacy) still saves
    if (fe.report(fe.run(productSchema(detail), form))) return;
    setSaving(true);
    try {
      const d = await postJson<{ row: Product; sameMfgCode?: string[] }>('/api/products', {
        ...form,
        sysCode: code || undefined,
        version: mode === 'add' ? undefined : version,
      });
      // the dialog fills from this cached answer when it opens again: re-read it now, or the next edit of
      // this product starts from the values before this save and writes them back
      if (detailKey) await loaded.mutate();
      push({
        kind: 'success',
        title: mode === 'add' ? 'เพิ่มอะไหล่แล้ว' : 'บันทึกการแก้ไขอะไหล่แล้ว',
        desc: d.row.sysCode,
      });
      if (d.sameMfgCode?.length)
        push({
          kind: 'warning',
          title: `รหัสผู้ผลิต ${d.row.mfgCode} ซ้ำกับอะไหล่อื่น`,
          desc: `${d.sameMfgCode.join(', ')} — ตรวจว่าไม่ได้สร้างอะไหล่ซ้ำ`,
        });
      onSave?.(d.row);
      onClose();
    } catch (e) {
      if (isStale(e) && detailKey)
        // saved by someone else since this form opened: "โหลดใหม่" re-reads this product into the open dialog
        // (a page reload lost the list's search and filters)
        push({
          kind: 'error',
          title: errMsg(e),
          desc: 'ระบบไม่บันทึก เพื่อไม่ให้ทับการแก้ไขนั้น — โหลดข้อมูลล่าสุดแล้วแก้ไขอีกครั้ง',
          action: {
            label: 'โหลดใหม่',
            onClick: () => void loaded.mutate().then(() => setFilledFor('')),
          },
        });
      else if (!fe.fromApi(e)) push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  if (!product && mode !== 'add') return null;
  const p: Product = detail ?? product ?? NEW_PRODUCT;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={mode === 'view' ? 'รายละเอียดอะไหล่' : mode === 'add' ? 'เพิ่มอะไหล่ใหม่' : 'แก้ไขข้อมูลอะไหล่'}
      description={
        mode === 'add'
          ? 'Mode: Add New · รหัสอะไหล่จะถูกสร้างอัตโนมัติ'
          : `Mode: ${mode === 'view' ? 'View' : 'Edit'} Data · Product ${p.sysCode}`
      }
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            {mode === 'view' ? 'ปิด' : 'ยกเลิก'}
          </Button>
          {mode !== 'view' && (
            <Button size="sm" onClick={save} disabled={saving}>
              {mode === 'add' ? 'บันทึกอะไหล่' : 'ยืนยันการแก้ไข'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[180px_1fr]">
          <PartImage
            image={image}
            broken={brokenImage === image}
            onBroken={() => setBrokenImage(image)}
            alt={p.name}
            ro={ro}
            code={code}
            uploading={uploading}
            onPick={onPickImage}
          />

          <ProductFields form={form} set={set} errors={fe.errors} ro={ro} p={p} seeCost={seeCost} />
        </div>

        <ProductModelChecklist
          form={form}
          set={set}
          errors={fe.errors}
          ro={ro}
          modelQ={modelQ}
          setModelQ={setModelQ}
          allBrands={allBrands}
          setAllBrands={setAllBrands}
        />

        <ProductColorStatus form={form} set={set} ro={ro} sysCode={p.sysCode} />

        {mode !== 'add' && (
          <p className="text-2xs text-muted-foreground">
            วันที่สร้าง: {p.createdDate || '—'} · สร้างโดย: {p.createdBy || '—'}
          </p>
        )}

        {mode !== 'add' && <ProductLegacyNotes detail={detail} />}

        {/* view-only stock tables */}
        {mode === 'view' && <ProductStockTables p={p} stockCard={stockCard} />}
      </div>
    </Modal>
  );
}

/** Part Image — the uploaded picture (a placeholder when there is none or it fails to load) + the upload button */
function PartImage({
  image,
  broken,
  onBroken,
  alt,
  ro,
  code,
  uploading,
  onPick,
}: {
  image: string;
  /** this file failed to load once → the placeholder */
  broken: boolean;
  onBroken: () => void;
  alt: string;
  ro: boolean;
  /** the part's code — a new part (none yet) is saved before its picture */
  code: string;
  uploading: boolean;
  onPick: (f: File | undefined) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Part Image</p>
      <div className="grid aspect-square place-items-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/40 text-muted-foreground">
        {image && !broken ? (
          <img src={fileUrl(image)} alt={alt} onError={onBroken} className="h-full w-full object-contain" />
        ) : (
          <div className="text-center">
            <ImageIcon className="mx-auto h-8 w-8 opacity-40" />
            <p className="mt-1 text-2xs">NO IMAGE</p>
          </div>
        )}
      </div>
      {!ro && (
        <label
          className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-input bg-muted/40 px-2 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
          title={code ? 'อัปโหลดรูป (JPG/PNG/WEBP ≤ 10MB)' : 'บันทึกอะไหล่ก่อน แล้วค่อยอัปโหลดรูป'}
        >
          <Upload className="h-3.5 w-3.5" /> {uploading ? 'กำลังอัปโหลด…' : 'เลือกไฟล์'}
          <input
            type="file"
            className="hidden"
            accept="image/jpeg,image/png,image/webp"
            disabled={!code || uploading}
            onChange={(e) => {
              onPick(e.target.files?.[0]);
              e.target.value = ''; // the same file can be chosen again
            }}
          />
        </label>
      )}
    </div>
  );
}
