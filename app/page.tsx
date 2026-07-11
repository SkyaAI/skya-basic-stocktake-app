"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Category = { id: string; name: string };
type Product = {
  id: string;
  code: string;
  name: string;
  category_id: string | null;
  categories?: Category | null;
};
type Session = { id: string; name: string; status: string; created_at: string };
type Entry = {
  id: string;
  session_id: string;
  product_id: string;
  count: number;
  created_at: string;
  products?: Product | null;
};
type Toast = { tone: "ok" | "error"; text: string } | null;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseConfigured =
  Boolean(supabaseUrl && supabaseAnonKey) &&
  !supabaseUrl?.includes("YOUR-PROJECT");

function normaliseProductCode(raw: string) {
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, "");
  const whMatch = cleaned.match(/^WH-?0*(\d+)$/);
  if (whMatch) return `WH-${whMatch[1].padStart(4, "0")}`;
  return cleaned.replace(/^([A-Z]{2})0*(\d{1,4})$/, (_, prefix, digits) => {
    return `${prefix}-${String(digits).padStart(4, "0")}`;
  });
}

function formatDateTime(value: string | Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function fileSafeName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function htmlCell(value: string | number) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function downloadTextFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const supabase = useMemo(() => (supabaseConfigured ? createClient() : null), []);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [mode, setMode] = useState<"count" | "report" | "catalogue">("count");

  const [newSessionName, setNewSessionName] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [countInput, setCountInput] = useState("");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingCount, setEditingCount] = useState("");
  const [newProductName, setNewProductName] = useState("");
  const [newProductCategoryId, setNewProductCategoryId] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [catalogueDraft, setCatalogueDraft] = useState({
    code: "",
    name: "",
    category_id: "",
  });

  const selectedSession = sessions.find((session) => session.id === selectedSessionId);
  const normalisedCode = normaliseProductCode(codeInput);
  const matchedProduct =
    products.find((product) => product.code === normalisedCode) ?? null;
  const suggestions = products
    .filter((product) => {
      const needle = normalisedCode || codeInput.trim().toUpperCase();
      return needle && product.code.includes(needle);
    })
    .slice(0, 5);

  const reportGroups = useMemo(() => {
    const groups = new Map<string, { total: number; rows: Entry[] }>();
    for (const entry of entries) {
      const category = entry.products?.categories?.name ?? "Uncategorised";
      const existing = groups.get(category) ?? { total: 0, rows: [] };
      existing.total += entry.count;
      existing.rows.push(entry);
      groups.set(category, existing);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);
  const reportGeneratedAt = useMemo(() => new Date(), [entries, selectedSessionId]);

  const sessionProductAverages = useMemo(() => {
    const totals = new Map<string, { sum: number; count: number }>();
    for (const entry of entries) {
      const value = totals.get(entry.product_id) ?? { sum: 0, count: 0 };
      value.sum += entry.count;
      value.count += 1;
      totals.set(entry.product_id, value);
    }
    return totals;
  }, [entries]);

  async function loadAll(sessionId = selectedSessionId) {
    if (!supabase) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const [sessionResult, categoryResult, productResult] = await Promise.all([
      supabase
        .from("stocktake_sessions")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase.from("categories").select("*").order("name"),
      supabase
        .from("products")
        .select("*, categories(*)")
        .order("code", { ascending: true }),
    ]);

    if (sessionResult.error || categoryResult.error || productResult.error) {
      setToast({ tone: "error", text: "Could not load stocktake data." });
      setLoading(false);
      return;
    }

    const loadedSessions = (sessionResult.data ?? []) as Session[];
    setSessions(loadedSessions);
    setCategories((categoryResult.data ?? []) as Category[]);
    setProducts((productResult.data ?? []) as Product[]);

    const nextSessionId = sessionId || loadedSessions[0]?.id || "";
    setSelectedSessionId(nextSessionId);
    if (nextSessionId) await loadEntries(nextSessionId);
    setLoading(false);
  }

  async function loadEntries(sessionId: string) {
    if (!supabase || !sessionId) return;
    const { data, error } = await supabase
      .from("stocktake_entries")
      .select("*, products(*, categories(*))")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false });
    if (error) {
      setToast({ tone: "error", text: "Could not load entries." });
      return;
    }
    setEntries((data ?? []) as Entry[]);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  useEffect(() => {
    if (selectedSessionId) loadEntries(selectedSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId]);

  async function createSession(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !newSessionName.trim()) return;
    const { data, error } = await supabase
      .from("stocktake_sessions")
      .insert({ name: newSessionName.trim(), status: "open" })
      .select()
      .single();
    if (error) {
      setToast({ tone: "error", text: "Could not create session." });
      return;
    }
    setNewSessionName("");
    setToast({ tone: "ok", text: "Session created." });
    await loadAll((data as Session).id);
  }

  async function saveEntry(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !selectedSessionId) return;
    const count = Number(countInput);
    if (!countInput || Number.isNaN(count)) {
      setToast({ tone: "error", text: "Count is required." });
      return;
    }
    if (count < 0) {
      setToast({ tone: "error", text: "Count must be 0 or more." });
      return;
    }

    setSaving(true);
    let productForEntry = matchedProduct;

    if (!productForEntry) {
      if (!normalisedCode || !newProductName.trim() || !newProductCategoryId) {
        setSaving(false);
        setToast({
          tone: "error",
          text: "Add the product name and category, then Save again.",
        });
        return;
      }

      const { data: newProduct, error: productError } = await supabase
        .from("products")
        .insert({
          code: normalisedCode,
          name: newProductName.trim(),
          category_id: newProductCategoryId,
        })
        .select("*, categories(*)")
        .single();

      if (productError) {
        setSaving(false);
        setToast({
          tone: "error",
          text: "Could not add product. Check for duplicate codes.",
        });
        return;
      }

      productForEntry = newProduct as Product;
    }

    const { error } = await supabase.from("stocktake_entries").insert({
      session_id: selectedSessionId,
      product_id: productForEntry.id,
      count,
    });
    setSaving(false);
    if (error) {
      setToast({ tone: "error", text: "Could not save entry. Check your connection." });
      return;
    }
    setCodeInput("");
    setCountInput("");
    setNewProductName("");
    setNewProductCategoryId("");
    setToast({ tone: "ok", text: "Entry saved." });
    await loadAll(selectedSessionId);
  }

  async function updateEntry(entryId: string) {
    if (!supabase) return;
    const count = Number(editingCount);
    if (!editingCount || Number.isNaN(count) || count < 0) {
      setToast({ tone: "error", text: "Enter a count of 0 or more." });
      return;
    }
    const { error } = await supabase
      .from("stocktake_entries")
      .update({ count })
      .eq("id", entryId);
    if (error) {
      setToast({ tone: "error", text: "Could not update entry." });
      return;
    }
    setEditingEntryId(null);
    setEditingCount("");
    setToast({ tone: "ok", text: "Entry updated." });
    await loadEntries(selectedSessionId);
  }

  async function deleteEntry(entryId: string) {
    if (!supabase || !window.confirm("Delete this count entry?")) return;
    const { error } = await supabase.from("stocktake_entries").delete().eq("id", entryId);
    if (error) {
      setToast({ tone: "error", text: "Could not delete entry." });
      return;
    }
    setToast({ tone: "ok", text: "Entry deleted." });
    await loadEntries(selectedSessionId);
  }

  async function addCategory(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !categoryName.trim()) return;
    const { error } = await supabase.from("categories").insert({ name: categoryName.trim() });
    if (error) {
      setToast({ tone: "error", text: "Could not add category." });
      return;
    }
    setCategoryName("");
    setToast({ tone: "ok", text: "Category added." });
    await loadAll(selectedSessionId);
  }

  async function addProduct(event: FormEvent, inline = false) {
    event.preventDefault();
    if (!supabase) return;
    const draft = inline
      ? {
          code: normalisedCode,
          name: newProductName,
          category_id: newProductCategoryId,
        }
      : {
          code: normaliseProductCode(catalogueDraft.code),
          name: catalogueDraft.name,
          category_id: catalogueDraft.category_id,
        };
    if (!draft.code || !draft.name.trim() || !draft.category_id) {
      setToast({ tone: "error", text: "Product code, name, and category are required." });
      return;
    }
    const { error } = await supabase.from("products").insert({
      code: draft.code,
      name: draft.name.trim(),
      category_id: draft.category_id,
    });
    if (error) {
      setToast({ tone: "error", text: "Could not add product. Check for duplicate codes." });
      return;
    }
    setNewProductName("");
    setNewProductCategoryId("");
    setCatalogueDraft({ code: "", name: "", category_id: "" });
    setToast({ tone: "ok", text: "Product added." });
    await loadAll(selectedSessionId);
  }

  async function renameCategory(category: Category, name: string) {
    if (!supabase || !name.trim() || name === category.name) return;
    const { error } = await supabase
      .from("categories")
      .update({ name: name.trim() })
      .eq("id", category.id);
    if (error) {
      setToast({ tone: "error", text: "Could not rename category." });
      return;
    }
    await loadAll(selectedSessionId);
  }

  async function updateProduct(product: Product, patch: Partial<Product>) {
    if (!supabase) return;
    const { error } = await supabase.from("products").update(patch).eq("id", product.id);
    if (error) {
      setToast({ tone: "error", text: "Could not update product." });
      return;
    }
    setToast({ tone: "ok", text: "Product updated." });
    await loadAll(selectedSessionId);
  }

  const statusText = supabaseConfigured
    ? `${entries.length} saved ${entries.length === 1 ? "entry" : "entries"}`
    : "Supabase env required";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="flex flex-col gap-3 border-b border-stone-300 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-800">
            Skya Stocktake
          </p>
          <h1 className="mt-1 text-3xl font-black text-stone-950 sm:text-4xl">
            Count stock. See the report now.
          </h1>
        </div>
        <div className="rounded border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700">
          {statusText}
        </div>
      </header>

      {!supabaseConfigured && (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          Pull Vercel env vars into <strong>.env.local</strong> to connect the live
          Supabase project. The UI is ready, but database writes are disabled until
          <strong> NEXT_PUBLIC_SUPABASE_URL</strong> and
          <strong> NEXT_PUBLIC_SUPABASE_ANON_KEY</strong> are present.
        </div>
      )}

      {toast && (
        <button
          className={`rounded border px-3 py-2 text-left text-sm font-semibold ${
            toast.tone === "ok"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-red-300 bg-red-50 text-red-900"
          }`}
          onClick={() => setToast(null)}
        >
          {toast.text}
        </button>
      )}

      <section className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <aside className="space-y-4">
          <div className="rounded border border-stone-300 bg-white p-3">
            <h2 className="text-sm font-black uppercase text-stone-800">Sessions</h2>
            <form className="mt-3 flex gap-2" onSubmit={createSession}>
              <input
                className="min-w-0 flex-1 rounded border border-stone-300 px-3 py-2"
                placeholder="New session"
                value={newSessionName}
                onChange={(event) => setNewSessionName(event.target.value)}
              />
              <button className="rounded bg-emerald-800 px-3 py-2 font-bold text-white">
                Add
              </button>
            </form>
            <div className="mt-3 space-y-2">
              {loading && <Skeleton label="Loading sessions" />}
              {!loading && sessions.length === 0 && (
                <p className="text-sm text-stone-600">No sessions yet. Create one to start counting.</p>
              )}
              {sessions.map((session) => (
                <button
                  key={session.id}
                  className={`w-full rounded border px-3 py-3 text-left ${
                    selectedSessionId === session.id
                      ? "border-emerald-800 bg-emerald-50"
                      : "border-stone-200 bg-stone-50"
                  }`}
                  onClick={() => setSelectedSessionId(session.id)}
                >
                  <span className="block font-bold text-stone-950">{session.name}</span>
                  <span className="text-xs uppercase text-stone-500">{session.status}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="space-y-4">
          <div className="flex gap-2 overflow-x-auto border-b border-stone-300 pb-2">
            {(["count", "report", "catalogue"] as const).map((tab) => (
              <button
                key={tab}
                className={`shrink-0 rounded px-4 py-2 text-sm font-black capitalize ${
                  mode === tab ? "bg-stone-950 text-white" : "bg-white text-stone-700"
                }`}
                onClick={() => setMode(tab)}
              >
                {tab === "count" ? "Count" : tab}
              </button>
            ))}
          </div>

          {mode === "count" && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <section className="rounded border border-stone-300 bg-white p-4">
                <h2 className="text-xl font-black text-stone-950">
                  {selectedSession?.name ?? "Select a session"}
                </h2>
                <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_130px_auto]" onSubmit={saveEntry}>
                  <div>
                    <label className="text-xs font-bold uppercase text-stone-600">Product code</label>
                    <input
                      className="mt-1 w-full rounded border border-stone-300 px-3 py-3 text-lg font-bold uppercase"
                      inputMode="text"
                      placeholder="WH-0042"
                      value={codeInput}
                      onChange={(event) => setCodeInput(event.target.value)}
                    />
                    {normalisedCode && (
                      <p className="mt-1 text-xs text-stone-500">Normalised: {normalisedCode}</p>
                    )}
                    {suggestions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {suggestions.map((product) => (
                          <button
                            className="rounded border border-stone-300 bg-stone-50 px-2 py-1 text-xs font-bold"
                            key={product.id}
                            type="button"
                            onClick={() => setCodeInput(product.code)}
                          >
                            {product.code}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase text-stone-600">Count</label>
                    <input
                      className="mt-1 w-full rounded border border-stone-300 px-3 py-3 text-lg font-bold"
                      inputMode="numeric"
                      min={0}
                      type="number"
                      value={countInput}
                      onChange={(event) => setCountInput(event.target.value)}
                    />
                  </div>
                  <button
                    className="self-end rounded bg-emerald-800 px-5 py-3 font-black text-white"
                    disabled={!selectedSessionId || saving}
                  >
                    {saving ? "Saving" : "Save"}
                  </button>
                </form>

                <ProductLookup
                  categories={categories}
                  matchedProduct={matchedProduct}
                  normalisedCode={normalisedCode}
                  newProductCategoryId={newProductCategoryId}
                  newProductName={newProductName}
                  onAddProduct={(event) => addProduct(event, true)}
                  onCategoryChange={setNewProductCategoryId}
                  onNameChange={setNewProductName}
                />
              </section>

              <EntryList
                entries={entries}
                editingCount={editingCount}
                editingEntryId={editingEntryId}
                productAverages={sessionProductAverages}
                onDelete={deleteEntry}
                onEdit={(entry) => {
                  setEditingEntryId(entry.id);
                  setEditingCount(String(entry.count));
                }}
                onEditingCount={setEditingCount}
                onSaveEdit={updateEntry}
              />
            </div>
          )}

          {mode === "report" && (
            <Report
              generatedAt={reportGeneratedAt}
              session={selectedSession}
              groups={reportGroups}
            />
          )}

          {mode === "catalogue" && (
            <Catalogue
              catalogueDraft={catalogueDraft}
              categories={categories}
              categoryName={categoryName}
              products={products}
              onAddCategory={addCategory}
              onAddProduct={(event) => addProduct(event, false)}
              onCategoryName={setCategoryName}
              onDraft={setCatalogueDraft}
              onRenameCategory={renameCategory}
              onUpdateProduct={updateProduct}
            />
          )}
        </section>
      </section>
    </main>
  );
}

function Skeleton({ label }: { label: string }) {
  return (
    <div className="rounded border border-stone-200 bg-stone-50 p-3 text-sm text-stone-500">
      {label}...
    </div>
  );
}

function ProductLookup({
  categories,
  matchedProduct,
  normalisedCode,
  newProductCategoryId,
  newProductName,
  onAddProduct,
  onCategoryChange,
  onNameChange,
}: {
  categories: Category[];
  matchedProduct: Product | null;
  normalisedCode: string;
  newProductCategoryId: string;
  newProductName: string;
  onAddProduct: (event: FormEvent) => void;
  onCategoryChange: (value: string) => void;
  onNameChange: (value: string) => void;
}) {
  if (!normalisedCode) {
    return <p className="mt-4 text-sm text-stone-500">Enter a product code to look it up.</p>;
  }

  if (matchedProduct) {
    return (
      <div className="mt-4 rounded border border-emerald-300 bg-emerald-50 p-3">
        <p className="font-black text-emerald-950">{matchedProduct.name}</p>
        <p className="text-sm text-emerald-800">
          {matchedProduct.code} · {matchedProduct.categories?.name ?? "Uncategorised"}
        </p>
      </div>
    );
  }

  return (
    <form className="mt-4 rounded border border-amber-300 bg-amber-50 p-3" onSubmit={onAddProduct}>
      <p className="font-black text-amber-950">Product not found. Add it to the catalogue?</p>
      <p className="mt-1 text-sm text-amber-900">
        Fill these fields, then press Save to add the product and count together.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <input
          className="rounded border border-amber-300 px-3 py-2"
          placeholder="Product name"
          value={newProductName}
          onChange={(event) => onNameChange(event.target.value)}
        />
        <select
          className="rounded border border-amber-300 px-3 py-2"
          value={newProductCategoryId}
          onChange={(event) => onCategoryChange(event.target.value)}
        >
          <option value="">Category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <button className="rounded bg-amber-700 px-3 py-2 font-black text-white sm:col-span-2">
          Add product only
        </button>
      </div>
    </form>
  );
}

function EntryList({
  entries,
  editingCount,
  editingEntryId,
  productAverages,
  onDelete,
  onEdit,
  onEditingCount,
  onSaveEdit,
}: {
  entries: Entry[];
  editingCount: string;
  editingEntryId: string | null;
  productAverages: Map<string, { sum: number; count: number }>;
  onDelete: (entryId: string) => void;
  onEdit: (entry: Entry) => void;
  onEditingCount: (value: string) => void;
  onSaveEdit: (entryId: string) => void;
}) {
  return (
    <section className="rounded border border-stone-300 bg-white p-4">
      <h2 className="text-lg font-black text-stone-950">Entries</h2>
      <div className="mt-3 space-y-2">
        {entries.length === 0 && (
          <p className="rounded border border-stone-200 bg-stone-50 p-3 text-sm text-stone-600">
            No entries yet. Start counting!
          </p>
        )}
        {entries.map((entry) => {
          const average = productAverages.get(entry.product_id);
          const isAnomaly =
            average && average.count > 1 && entry.count > (average.sum / average.count) * 3;
          return (
            <div
              key={entry.id}
              className={`rounded border p-3 ${
                isAnomaly ? "border-amber-400 bg-amber-50" : "border-stone-200 bg-stone-50"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-black text-stone-950">
                    {entry.products?.code ?? "Unknown"} · {entry.products?.name ?? "Deleted product"}
                  </p>
                  <p className="text-sm text-stone-600">
                    {entry.products?.categories?.name ?? "Uncategorised"}
                    {isAnomaly ? " · Count anomaly" : ""}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-stone-500">
                    Saved {formatDateTime(entry.created_at)}
                  </p>
                </div>
                <p className="text-2xl font-black text-stone-950">{entry.count}</p>
              </div>
              {editingEntryId === entry.id ? (
                <div className="mt-3 flex gap-2">
                  <input
                    className="w-28 rounded border border-stone-300 px-3 py-2 font-bold"
                    min={0}
                    type="number"
                    value={editingCount}
                    onChange={(event) => onEditingCount(event.target.value)}
                  />
                  <button
                    className="rounded bg-emerald-800 px-3 py-2 font-bold text-white"
                    onClick={() => onSaveEdit(entry.id)}
                  >
                    Save
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  <button
                    className="rounded border border-stone-300 bg-white px-3 py-2 text-sm font-bold"
                    onClick={() => onEdit(entry)}
                  >
                    Edit
                  </button>
                  <button
                    className="rounded border border-red-300 bg-white px-3 py-2 text-sm font-bold text-red-700"
                    onClick={() => onDelete(entry.id)}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Report({
  generatedAt,
  groups,
  session,
}: {
  generatedAt: Date;
  groups: [string, { total: number; rows: Entry[] }][];
  session?: Session;
}) {
  const sessionName = session?.name ?? "Stocktake Report";
  const generatedStamp = formatDateTime(generatedAt);
  const totalUnits = groups.reduce((sum, [, group]) => sum + group.total, 0);
  const filenameBase = `${fileSafeName(sessionName) || "stocktake-report"}-${generatedAt
    .toISOString()
    .slice(0, 10)}`;
  const rowData = groups.flatMap(([category, group]) =>
    group.rows.map((entry) => ({
      category,
      code: entry.products?.code ?? "",
      name: entry.products?.name ?? "",
      count: entry.count,
      savedAt: formatDateTime(entry.created_at),
    })),
  );

  function exportCsv() {
    const rows = [
      ["Session", sessionName],
      ["Generated", generatedStamp],
      [],
      ["Category", "Product Code", "Product Name", "Count", "Saved At"],
      ...rowData.map((row) => [
        row.category,
        row.code,
        row.name,
        String(row.count),
        row.savedAt,
      ]),
      [],
      ["Total Units", String(totalUnits)],
    ];

    downloadTextFile(
      `${filenameBase}.csv`,
      rows.map((row) => row.map(csvCell).join(",")).join("\n"),
      "text/csv;charset=utf-8",
    );
  }

  function exportExcel() {
    const bodyRows = rowData
      .map(
        (row) => `
          <tr>
            <td>${htmlCell(row.category)}</td>
            <td>${htmlCell(row.code)}</td>
            <td>${htmlCell(row.name)}</td>
            <td>${htmlCell(row.count)}</td>
            <td>${htmlCell(row.savedAt)}</td>
          </tr>`,
      )
      .join("");
    const workbook = `
      <html>
        <head><meta charset="utf-8" /></head>
        <body>
          <table>
            <tr><th colspan="5">Skya Stocktake Report</th></tr>
            <tr><td>Session</td><td colspan="4">${htmlCell(sessionName)}</td></tr>
            <tr><td>Generated</td><td colspan="4">${htmlCell(generatedStamp)}</td></tr>
            <tr></tr>
            <tr>
              <th>Category</th>
              <th>Product Code</th>
              <th>Product Name</th>
              <th>Count</th>
              <th>Saved At</th>
            </tr>
            ${bodyRows}
            <tr></tr>
            <tr><td>Total Units</td><td colspan="4">${htmlCell(totalUnits)}</td></tr>
          </table>
        </body>
      </html>`;

    downloadTextFile(
      `${filenameBase}.xls`,
      workbook,
      "application/vnd.ms-excel;charset=utf-8",
    );
  }

  function reportPrintHtml(mode: "print" | "pdf") {
    const groupedRows = groups
      .map(
        ([category, group]) => `
          <section>
            <h2>${htmlCell(category)} <span>${htmlCell(group.total)}</span></h2>
            <table>
              <thead>
                <tr>
                  <th>Product Code</th>
                  <th>Product Name</th>
                  <th>Count</th>
                  <th>Saved At</th>
                </tr>
              </thead>
              <tbody>
                ${group.rows
                  .map(
                    (entry) => `
                      <tr>
                        <td>${htmlCell(entry.products?.code ?? "")}</td>
                        <td>${htmlCell(entry.products?.name ?? "")}</td>
                        <td>${htmlCell(entry.count)}</td>
                        <td>${htmlCell(formatDateTime(entry.created_at))}</td>
                      </tr>`,
                  )
                  .join("")}
              </tbody>
            </table>
          </section>`,
      )
      .join("");

    return `
      <!doctype html>
      <html>
        <head>
          <title>${htmlCell(sessionName)} ${mode === "pdf" ? "PDF" : "Print"}</title>
          <style>
            body { color: #111; font-family: Arial, sans-serif; margin: 32px; }
            header { border-bottom: 2px solid #111; margin-bottom: 20px; padding-bottom: 12px; }
            h1 { font-size: 28px; margin: 0 0 6px; }
            h2 { align-items: center; background: #111; color: white; display: flex; font-size: 18px; justify-content: space-between; margin: 20px 0 0; padding: 8px 10px; }
            p { margin: 4px 0; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
            th { background: #f0f0f0; }
            td:nth-child(3), th:nth-child(3) { text-align: right; }
            .total { font-size: 16px; font-weight: 700; margin-top: 16px; text-align: right; }
          </style>
        </head>
        <body>
          <header>
            <h1>Skya Stocktake Report</h1>
            <p>Session: ${htmlCell(sessionName)}</p>
            <p>Generated: ${htmlCell(generatedStamp)}</p>
          </header>
          ${groupedRows || "<p>No report rows yet.</p>"}
          <p class="total">Total units: ${htmlCell(totalUnits)}</p>
        </body>
      </html>`;
  }

  function openPrintableReport(mode: "print" | "pdf") {
    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) {
      window.print();
      return;
    }
    printWindow.document.write(reportPrintHtml(mode));
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  return (
    <section className="rounded border border-stone-300 bg-white p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-black text-stone-950">Report</h2>
          <p className="text-sm text-stone-600">{session?.name ?? "Select a session"}</p>
          <p className="text-xs font-semibold text-stone-500">
            Generated {generatedStamp}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded border border-stone-300 bg-white px-3 py-2 text-sm font-black"
            onClick={exportCsv}
            type="button"
          >
            Export CSV
          </button>
          <button
            className="rounded border border-stone-300 bg-white px-3 py-2 text-sm font-black"
            onClick={exportExcel}
            type="button"
          >
            Excel
          </button>
          <button
            className="rounded border border-stone-300 bg-white px-3 py-2 text-sm font-black"
            onClick={() => openPrintableReport("pdf")}
            type="button"
          >
            PDF
          </button>
          <button
            className="rounded border border-stone-300 bg-white px-3 py-2 text-sm font-black"
            onClick={() => openPrintableReport("print")}
            type="button"
          >
            Print
          </button>
          <p className="rounded bg-stone-100 px-3 py-2 text-sm font-black">
            {totalUnits} total units
          </p>
        </div>
      </div>
      <div className="mt-4 space-y-4">
        {groups.length === 0 && (
          <p className="rounded border border-stone-200 bg-stone-50 p-3 text-sm text-stone-600">
            No report rows yet. Save counts to see grouped totals immediately.
          </p>
        )}
        {groups.map(([category, group]) => (
          <div key={category} className="overflow-hidden rounded border border-stone-200">
            <div className="flex items-center justify-between bg-stone-950 px-3 py-2 text-white">
              <h3 className="font-black">{category}</h3>
              <span className="font-black">{group.total}</span>
            </div>
            <div className="divide-y divide-stone-200">
              {group.rows.map((entry) => (
                <div
                  className="grid grid-cols-[90px_1fr_70px] gap-2 px-3 py-2 text-sm"
                  key={entry.id}
                >
                  <span className="font-black">{entry.products?.code}</span>
                  <span>
                    <span className="block">{entry.products?.name}</span>
                    <span className="block text-xs font-semibold text-stone-500">
                      Saved {formatDateTime(entry.created_at)}
                    </span>
                  </span>
                  <span className="text-right font-black">{entry.count}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Catalogue({
  catalogueDraft,
  categories,
  categoryName,
  products,
  onAddCategory,
  onAddProduct,
  onCategoryName,
  onDraft,
  onRenameCategory,
  onUpdateProduct,
}: {
  catalogueDraft: { code: string; name: string; category_id: string };
  categories: Category[];
  categoryName: string;
  products: Product[];
  onAddCategory: (event: FormEvent) => void;
  onAddProduct: (event: FormEvent) => void;
  onCategoryName: (value: string) => void;
  onDraft: (value: { code: string; name: string; category_id: string }) => void;
  onRenameCategory: (category: Category, name: string) => void;
  onUpdateProduct: (product: Product, patch: Partial<Product>) => void;
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <div className="rounded border border-stone-300 bg-white p-4">
        <h2 className="text-xl font-black text-stone-950">Product Catalogue</h2>
        <form className="mt-4 grid gap-2 md:grid-cols-[140px_1fr_190px_auto]" onSubmit={onAddProduct}>
          <input
            className="rounded border border-stone-300 px-3 py-2 uppercase"
            placeholder="Code"
            value={catalogueDraft.code}
            onChange={(event) => onDraft({ ...catalogueDraft, code: event.target.value })}
          />
          <input
            className="rounded border border-stone-300 px-3 py-2"
            placeholder="Product name"
            value={catalogueDraft.name}
            onChange={(event) => onDraft({ ...catalogueDraft, name: event.target.value })}
          />
          <select
            className="rounded border border-stone-300 px-3 py-2"
            value={catalogueDraft.category_id}
            onChange={(event) => onDraft({ ...catalogueDraft, category_id: event.target.value })}
          >
            <option value="">Category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <button className="rounded bg-emerald-800 px-3 py-2 font-black text-white">
            Add
          </button>
        </form>
        <div className="mt-4 divide-y divide-stone-200 rounded border border-stone-200">
          {products.map((product) => (
            <div className="grid gap-2 p-3 md:grid-cols-[120px_1fr_190px]" key={product.id}>
              <input
                className="rounded border border-stone-300 px-2 py-2 font-bold uppercase"
                defaultValue={product.code}
                onBlur={(event) =>
                  onUpdateProduct(product, { code: normaliseProductCode(event.target.value) })
                }
              />
              <input
                className="rounded border border-stone-300 px-2 py-2"
                defaultValue={product.name}
                onBlur={(event) => onUpdateProduct(product, { name: event.target.value })}
              />
              <select
                className="rounded border border-stone-300 px-2 py-2"
                defaultValue={product.category_id ?? ""}
                onChange={(event) =>
                  onUpdateProduct(product, { category_id: event.target.value })
                }
              >
                <option value="">Uncategorised</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded border border-stone-300 bg-white p-4">
        <h2 className="text-xl font-black text-stone-950">Categories</h2>
        <form className="mt-4 flex gap-2" onSubmit={onAddCategory}>
          <input
            className="min-w-0 flex-1 rounded border border-stone-300 px-3 py-2"
            placeholder="New category"
            value={categoryName}
            onChange={(event) => onCategoryName(event.target.value)}
          />
          <button className="rounded bg-emerald-800 px-3 py-2 font-black text-white">
            Add
          </button>
        </form>
        <div className="mt-4 space-y-2">
          {categories.map((category) => (
            <input
              className="w-full rounded border border-stone-300 px-3 py-2"
              defaultValue={category.name}
              key={category.id}
              onBlur={(event) => onRenameCategory(category, event.target.value)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
