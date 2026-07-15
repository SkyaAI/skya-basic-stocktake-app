"use client";

import {
  ChangeEvent,
  FormEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type Category = { id: string; name: string; organisation_id?: string };
type Product = {
  id: string;
  code: string;
  name: string;
  category_id: string | null;
  organisation_id?: string;
  categories?: Category | null;
};
type Session = { id: string; name: string; status: string; created_at: string; organisation_id?: string };
type Entry = {
  id: string;
  session_id: string;
  product_id: string;
  organisation_id?: string;
  count: number;
  created_at: string;
  location: string | null;
  products?: Product | null;
};
type Toast = { tone: "ok" | "error"; text: string } | null;
type CatalogueImportRow = {
  category: string;
  code: string;
  name: string;
};
type Organisation = { id: string; name: string };
type OrganisationRole = "warehouse_staff" | "supervisor" | "admin";
type OrganisationMember = {
  id: string;
  organisation_id: string;
  user_id: string | null;
  invited_email: string | null;
  role: OrganisationRole;
  status: "pending" | "active" | "disabled";
};
type UserProfile = {
  username: string;
  email: string;
  default_organisation_id: string | null;
  display_name?: string | null;
};
type NavMode = "count" | "report" | "catalogue" | "organisation";
type NavIconProps = { className?: string };
type NavItem = {
  id: NavMode;
  label: string;
  description: string;
  icon: (props: NavIconProps) => ReactNode;
};
type SpreadsheetRow = string[];
type ZipEntry = {
  compressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
  name: string;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const appUrl = process.env.NEXT_PUBLIC_APP_URL;
const supabaseConfigured =
  Boolean(supabaseUrl && supabaseAnonKey) &&
  !supabaseUrl?.includes("YOUR-PROJECT");

const NAV_ITEMS: NavItem[] = [
  {
    id: "count",
    label: "Count",
    description: "Record stock",
    icon: ClipboardIcon,
  },
  {
    id: "report",
    label: "Report",
    description: "Review totals",
    icon: ChartIcon,
  },
  {
    id: "catalogue",
    label: "Catalogue",
    description: "Manage products",
    icon: BoxesIcon,
  },
  {
    id: "organisation",
    label: "Organisation",
    description: "Manage access",
    icon: BuildingIcon,
  },
];
const SESSION_PRESETS = [
  "Morning Count",
  "End of Day Check",
  "July Audit",
  "Weekly Stocktake",
  "New Year Eve Audit",
];

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

function getAuthRedirectUrl() {
  const configuredUrl = appUrl?.replace(/\/$/, "");
  const browserOrigin =
    typeof window === "undefined" ? "http://localhost:3000" : window.location.origin;
  const origin =
    configuredUrl && !configuredUrl.includes("localhost")
      ? configuredUrl
      : browserOrigin;

  return `${origin}/auth/callback`;
}

function normaliseUsername(value: string) {
  return value.trim().toLowerCase();
}

function authCallbackMessage(message: string) {
  if (message.toLowerCase().includes("pkce code verifier")) {
    return "That confirmation link was already used or opened in another browser. If you are signed in, you can continue.";
  }

  return message;
}

function cleanAuthCallbackUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  url.searchParams.delete("auth_error");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function parseCsvRows(text: string) {
  const rows: SpreadsheetRow[] = [];
  let row: SpreadsheetRow = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseCatalogueRows(rows: SpreadsheetRow[]): CatalogueImportRow[] {
  const headerIndex = rows.findIndex((row) =>
    row.map((cell) => cell.toLowerCase()).includes("product code"),
  );
  const dataRows = rows.slice(headerIndex >= 0 ? headerIndex + 1 : 1);

  return dataRows
    .map((row) => ({
      code: normaliseProductCode(row[0] ?? ""),
      name: row[1]?.trim() ?? "",
      category: row[2]?.trim() ?? "",
    }))
    .filter((row) => row.category && row.code && row.name)
    .filter(
      (row) =>
        !(
          row.category === "Sample Category" &&
          row.code === "CODE-0001" &&
          row.name === "Sample Product Name"
        ),
    );
}

function parseCatalogueImport(text: string): CatalogueImportRow[] {
  const trimmed = text.trim();
  const rows = trimmed.includes("<table")
    ? Array.from(
        new DOMParser()
          .parseFromString(trimmed, "text/html")
          .querySelectorAll("tr"),
      ).map((row) =>
        Array.from(row.querySelectorAll("th,td")).map((cell) =>
          cell.textContent?.trim() ?? "",
        ),
      )
    : parseCsvRows(trimmed);

  return parseCatalogueRows(rows);
}

function readUint16(view: DataView, offset: number) {
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number) {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(view: DataView) {
  const minOffset = Math.max(0, view.byteLength - 66000);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (readUint32(view, offset) === 0x06054b50) return offset;
  }
  throw new Error("Could not read the Excel workbook.");
}

function readZipEntries(view: DataView, bytes: Uint8Array) {
  const decoder = new TextDecoder();
  const endOffset = findEndOfCentralDirectory(view);
  const entryCount = readUint16(view, endOffset + 10);
  let offset = readUint32(view, endOffset + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(view, offset) !== 0x02014b50) break;
    const compressionMethod = readUint16(view, offset + 10);
    const compressedSize = readUint32(view, offset + 20);
    const nameLength = readUint16(view, offset + 28);
    const extraLength = readUint16(view, offset + 30);
    const commentLength = readUint16(view, offset + 32);
    const localHeaderOffset = readUint32(view, offset + 42);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));

    entries.push({ compressedSize, compressionMethod, localHeaderOffset, name });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function readZipEntryText(
  view: DataView,
  bytes: Uint8Array,
  entry: ZipEntry,
) {
  const localOffset = entry.localHeaderOffset;
  if (readUint32(view, localOffset) !== 0x04034b50) {
    throw new Error("Could not read the Excel workbook.");
  }

  const localNameLength = readUint16(view, localOffset + 26);
  const localExtraLength = readUint16(view, localOffset + 28);
  const dataStart = localOffset + 30 + localNameLength + localExtraLength;
  const compressed = bytes.slice(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    return new TextDecoder().decode(compressed);
  }

  if (entry.compressionMethod !== 8 || typeof DecompressionStream === "undefined") {
    throw new Error("This Excel file uses an unsupported compression format.");
  }

  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

function cellColumnIndex(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0] ?? "";
  return [...letters.toUpperCase()].reduce(
    (total, letter) => total * 26 + letter.charCodeAt(0) - 64,
    0,
  ) - 1;
}

function textFromXmlElement(element: Element | null) {
  return element?.textContent?.trim() ?? "";
}

function parseXlsxRows(sheetXml: string, sharedStringsXml = "") {
  const parser = new DOMParser();
  const sharedStrings = sharedStringsXml
    ? Array.from(
        parser.parseFromString(sharedStringsXml, "application/xml").querySelectorAll("si"),
      ).map((item) =>
        Array.from(item.querySelectorAll("t"))
          .map((node) => node.textContent ?? "")
          .join("")
          .trim(),
      )
    : [];
  const sheet = parser.parseFromString(sheetXml, "application/xml");

  return Array.from(sheet.querySelectorAll("sheetData row")).map((row) => {
    const cells: SpreadsheetRow = [];
    for (const cell of Array.from(row.querySelectorAll("c"))) {
      const reference = cell.getAttribute("r") ?? "";
      const index = Math.max(cellColumnIndex(reference), cells.length);
      const type = cell.getAttribute("t");
      const rawValue =
        type === "inlineStr"
          ? textFromXmlElement(cell.querySelector("is t"))
          : textFromXmlElement(cell.querySelector("v"));
      cells[index] =
        type === "s" ? sharedStrings[Number(rawValue)] ?? "" : rawValue;
    }
    return cells.map((value) => value?.trim() ?? "");
  });
}

async function parseXlsxCatalogueImport(file: File) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const entries = readZipEntries(view, bytes);
  const entryByName = new Map(entries.map((entry) => [entry.name, entry]));
  const firstWorksheet = entries.find((entry) =>
    /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name),
  );

  if (!firstWorksheet) throw new Error("No worksheet found.");

  const [sheetXml, sharedStringsXml] = await Promise.all([
    readZipEntryText(view, bytes, firstWorksheet),
    entryByName.has("xl/sharedStrings.xml")
      ? readZipEntryText(view, bytes, entryByName.get("xl/sharedStrings.xml")!)
      : Promise.resolve(""),
  ]);

  return parseCatalogueRows(parseXlsxRows(sheetXml, sharedStringsXml));
}

async function parseCatalogueImportFile(file: File) {
  if (file.name.toLowerCase().endsWith(".xlsx")) {
    return parseXlsxCatalogueImport(file);
  }

  return parseCatalogueImport(await file.text());
}

export default function Home() {
  const supabase = useMemo(() => (supabaseConfigured ? createClient() : null), []);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const productCodeInputRef = useRef<HTMLInputElement | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [authEmail, setAuthEmail] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [activeOrganisationId, setActiveOrganisationId] = useState("");
  const [organisationMembers, setOrganisationMembers] = useState<OrganisationMember[]>([]);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<OrganisationRole>("warehouse_staff");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [mode, setMode] = useState<NavMode>("count");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [newSessionName, setNewSessionName] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [countInput, setCountInput] = useState("");
  const [locationInput, setLocationInput] = useState("");
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
  const activeOrganisation = organisations.find(
    (organisation) => organisation.id === activeOrganisationId,
  );
  const activeMember = organisationMembers.find(
    (member) =>
      member.organisation_id === activeOrganisationId &&
      member.user_id === user?.id &&
      member.status === "active",
  );
  const activeRole = activeMember?.role ?? null;
  const canManageCatalogue = activeRole === "admin";
  const canManageMembers = activeRole === "admin";
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

  useEffect(() => {
    if (!mobileNavOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileNavOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileNavOpen]);

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

  async function handleAuth(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const identifier = authEmail.trim();
    let emailForPassword = identifier;

    setSaving(true);
    if (authMode === "sign-in" && !identifier.includes("@")) {
      const username = normaliseUsername(identifier);
      const { data, error } = await supabase
        .from("user_profiles")
        .select("email")
        .eq("username", username)
        .maybeSingle();

      if (error || !data?.email) {
        setSaving(false);
        setToast({ tone: "error", text: "No account found for that username." });
        return;
      }
      emailForPassword = data.email;
    }

    if (authMode === "sign-up") {
      const username = normaliseUsername(authUsername);
      if (!/^[a-z0-9_]{3,30}$/.test(username)) {
        setSaving(false);
        setToast({
          tone: "error",
          text: "Username must be 3-30 characters: letters, numbers, and underscores only.",
        });
        return;
      }
      if (!identifier.includes("@")) {
        setSaving(false);
        setToast({ tone: "error", text: "Enter a valid email address." });
        return;
      }
    }

    const authAction =
      authMode === "sign-in"
        ? supabase.auth.signInWithPassword({
            email: emailForPassword,
            password: authPassword,
          })
        : supabase.auth.signUp({
            email: emailForPassword,
            password: authPassword,
            options: {
              emailRedirectTo: getAuthRedirectUrl(),
              data: {
                username: normaliseUsername(authUsername),
              },
            },
          });
    const { error } = await authAction;
    setSaving(false);
    if (error) {
      setToast({ tone: "error", text: error.message });
      return;
    }
    setToast({
      tone: "ok",
      text:
        authMode === "sign-in"
          ? "Signed in."
          : "Account created. Check your email if confirmation is enabled.",
    });
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
    setUserProfile(null);
    setOrganisations([]);
    setActiveOrganisationId("");
    setOrganisationMembers([]);
    setSessions([]);
    setSelectedSessionId("");
    setCategories([]);
    setProducts([]);
    setEntries([]);
    setToast({ tone: "ok", text: "Signed out." });
  }

  async function loadOrganisationContext() {
    if (!supabase || !user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const [profileResult, membershipResult] = await Promise.all([
      supabase
        .from("user_profiles")
        .select("username,email,display_name,default_organisation_id")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("organisation_members")
        .select("*, organisations(id,name)")
        .eq("status", "active")
        .order("created_at", { ascending: true }),
    ]);

    if (profileResult.error || membershipResult.error) {
      setToast({ tone: "error", text: "Could not load organisation access." });
      setLoading(false);
      return;
    }

    const profile = (profileResult.data as UserProfile | null) ?? null;
    const memberships = (membershipResult.data ?? []) as (OrganisationMember & {
      organisations?: Organisation | null;
    })[];
    const loadedOrganisations = memberships
      .map((membership) => membership.organisations)
      .filter((organisation): organisation is Organisation => Boolean(organisation));
    const nextOrganisationId =
      activeOrganisationId ||
      profile?.default_organisation_id ||
      loadedOrganisations[0]?.id ||
      "";

    setUserProfile(profile);
    setOrganisationMembers(memberships.map(({ organisations: _organisations, ...member }) => member));
    setOrganisations(loadedOrganisations);
    setActiveOrganisationId(nextOrganisationId);

    if (!nextOrganisationId) {
      setSessions([]);
      setSelectedSessionId("");
      setCategories([]);
      setProducts([]);
      setEntries([]);
      setLoading(false);
      return;
    }

    await loadAll("", nextOrganisationId);
  }

  async function loadAll(sessionId = selectedSessionId, organisationId = activeOrganisationId) {
    if (!supabase || !user || !organisationId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const [sessionResult, categoryResult, productResult] = await Promise.all([
      supabase
        .from("stocktake_sessions")
        .select("*")
        .eq("organisation_id", organisationId)
        .order("created_at", { ascending: false }),
      supabase.from("categories").select("*").eq("organisation_id", organisationId).order("name"),
      supabase
        .from("products")
        .select("*, categories(*)")
        .eq("organisation_id", organisationId)
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
    if (nextSessionId) await loadEntries(nextSessionId, organisationId);
    setLoading(false);
  }

  async function loadEntries(sessionId: string, organisationId = activeOrganisationId) {
    if (!supabase || !user || !sessionId || !organisationId) return;
    const { data, error } = await supabase
      .from("stocktake_entries")
      .select("*, products(*, categories(*))")
      .eq("session_id", sessionId)
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false });
    if (error) {
      setToast({ tone: "error", text: "Could not load entries." });
      return;
    }
    setEntries((data ?? []) as Entry[]);
  }

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      setLoading(false);
      return;
    }

    const supabaseClient = supabase;
    let mounted = true;
    async function initialiseAuth() {
      const searchParams = new URLSearchParams(window.location.search);
      const code = searchParams.get("code");
      const authError = searchParams.get("auth_error");
      let callbackError = authError ? authCallbackMessage(authError) : "";

      if (code) {
        const { error } = await supabaseClient.auth.exchangeCodeForSession(code);
        if (error) {
          callbackError = authCallbackMessage(error.message);
        }
      }

      if (code || authError) {
        cleanAuthCallbackUrl();
      }

      const { data } = await supabaseClient.auth.getUser();
      if (!mounted) return;
      setUser(data.user);
      setAuthLoading(false);
      if (!data.user) setLoading(false);
      if (callbackError) {
        setToast({
          tone: data.user ? "ok" : "error",
          text: data.user ? "Signed in. You can continue." : callbackError,
        });
      }
    }

    initialiseAuth();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) {
        setUserProfile(null);
        setOrganisations([]);
        setActiveOrganisationId("");
        setOrganisationMembers([]);
        setSessions([]);
        setSelectedSessionId("");
        setCategories([]);
        setProducts([]);
        setEntries([]);
      }
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  useEffect(() => {
    if (user) loadOrganisationContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (activeOrganisationId) loadAll("", activeOrganisationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrganisationId]);

  useEffect(() => {
    if (selectedSessionId) loadEntries(selectedSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId]);

  useEffect(() => {
    if (mode === "organisation" && !canManageMembers) {
      setMode("count");
    }
  }, [canManageMembers, mode]);

  async function createNamedSession(name: string) {
    const sessionName = name.trim();
    if (!supabase || !user || !activeOrganisationId || !sessionName) return;

    const existingSession = sessions.find(
      (session) => session.name.toLowerCase() === sessionName.toLowerCase(),
    );
    if (existingSession) {
      setSelectedSessionId(existingSession.id);
      setToast({ tone: "ok", text: `${existingSession.name} selected.` });
      return;
    }

    const { data, error } = await supabase
      .from("stocktake_sessions")
      .insert({
        name: sessionName,
        status: "open",
        organisation_id: activeOrganisationId,
        created_by: user.id,
        user_id: user.id,
      })
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

  async function createSession(event: FormEvent) {
    event.preventDefault();
    await createNamedSession(newSessionName);
  }

  async function saveEntry(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !user || !activeOrganisationId || !selectedSessionId) return;
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
          organisation_id: activeOrganisationId,
          created_by: user.id,
          user_id: user.id,
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
      organisation_id: activeOrganisationId,
      session_id: selectedSessionId,
      product_id: productForEntry.id,
      count,
      location: locationInput.trim() || null,
      entered_by_user_id: user.id,
      user_id: user.id,
    });
    setSaving(false);
    if (error) {
      setToast({ tone: "error", text: "Could not save entry. Check your connection." });
      return;
    }
    setCodeInput("");
    setCountInput("");
    setLocationInput("");
    setNewProductName("");
    setNewProductCategoryId("");
    setToast({ tone: "ok", text: "Entry saved." });
    await loadAll(selectedSessionId);
    requestAnimationFrame(() => productCodeInputRef.current?.focus());
  }

  async function updateEntry(entryId: string) {
    if (!supabase || !user || !activeOrganisationId) return;
    const count = Number(editingCount);
    if (!editingCount || Number.isNaN(count) || count < 0) {
      setToast({ tone: "error", text: "Enter a count of 0 or more." });
      return;
    }
    const { error } = await supabase
      .from("stocktake_entries")
      .update({ count })
      .eq("id", entryId)
      .eq("organisation_id", activeOrganisationId);
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
    if (!supabase || !user || !activeOrganisationId || !window.confirm("Delete this count entry?")) return;
    const { error } = await supabase
      .from("stocktake_entries")
      .delete()
      .eq("id", entryId)
      .eq("organisation_id", activeOrganisationId);
    if (error) {
      setToast({ tone: "error", text: "Could not delete entry." });
      return;
    }
    setToast({ tone: "ok", text: "Entry deleted." });
    await loadEntries(selectedSessionId);
  }

  async function addCategory(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !user || !activeOrganisationId || !categoryName.trim()) return;
    const { error } = await supabase
      .from("categories")
      .insert({
        name: categoryName.trim(),
        organisation_id: activeOrganisationId,
        created_by: user.id,
        user_id: user.id,
      });
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
    if (!supabase || !user || !activeOrganisationId) return;
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
      organisation_id: activeOrganisationId,
      created_by: user.id,
      user_id: user.id,
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
    if (!supabase || !user || !activeOrganisationId || !name.trim() || name === category.name) return;
    const { error } = await supabase
      .from("categories")
      .update({ name: name.trim() })
      .eq("id", category.id)
      .eq("organisation_id", activeOrganisationId);
    if (error) {
      setToast({ tone: "error", text: "Could not rename category." });
      return;
    }
    await loadAll(selectedSessionId);
  }

  async function updateProduct(product: Product, patch: Partial<Product>) {
    if (!supabase || !user || !activeOrganisationId) return;
    const { error } = await supabase
      .from("products")
      .update(patch)
      .eq("id", product.id)
      .eq("organisation_id", activeOrganisationId);
    if (error) {
      setToast({ tone: "error", text: "Could not update product." });
      return;
    }
    setToast({ tone: "ok", text: "Product updated." });
    await loadAll(selectedSessionId);
  }

  function downloadCatalogueTemplate() {
    const template = `
      <html>
        <head><meta charset="utf-8" /></head>
        <body>
          <table>
            <tr>
              <th>Product Code</th>
              <th>Product Name</th>
              <th>Category</th>
            </tr>
            <tr>
              <td>CODE-0001</td>
              <td>Sample Product Name</td>
              <td>Sample Category</td>
            </tr>
          </table>
        </body>
      </html>`;

    downloadTextFile(
      "skya-product-catalogue-template.xls",
      template,
      "application/vnd.ms-excel;charset=utf-8",
    );
  }

  async function importCatalogueTemplate(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !supabase || !user || !activeOrganisationId) return;

    try {
      const rows = await parseCatalogueImportFile(file);
      if (rows.length === 0) {
        setToast({
          tone: "error",
          text: "No catalogue rows found. Keep headings: Product Code, Product Name, Category.",
        });
        return;
      }

      const { data: categoryData, error: categoryLoadError } = await supabase
        .from("categories")
        .select("*")
        .eq("organisation_id", activeOrganisationId);
      if (categoryLoadError) throw categoryLoadError;

      const categoryByName = new Map(
        ((categoryData ?? []) as Category[]).map((category) => [
          category.name.toLowerCase(),
          category,
        ]),
      );

      for (const categoryNameFromFile of [...new Set(rows.map((row) => row.category))]) {
        if (categoryByName.has(categoryNameFromFile.toLowerCase())) continue;
        const { data, error } = await supabase
          .from("categories")
          .insert({
            name: categoryNameFromFile,
            organisation_id: activeOrganisationId,
            created_by: user.id,
            user_id: user.id,
          })
          .select()
          .single();
        if (error) throw error;
        const category = data as Category;
        categoryByName.set(category.name.toLowerCase(), category);
      }

      const { data: productData, error: productLoadError } = await supabase
        .from("products")
        .select("*")
        .eq("organisation_id", activeOrganisationId);
      if (productLoadError) throw productLoadError;

      const productByCode = new Map(
        ((productData ?? []) as Product[]).map((product) => [product.code, product]),
      );

      for (const row of rows) {
        const category = categoryByName.get(row.category.toLowerCase());
        if (!category) continue;
        const existingProduct = productByCode.get(row.code);
        if (existingProduct) {
          const { error } = await supabase
            .from("products")
            .update({
              name: row.name,
              category_id: category.id,
            })
            .eq("id", existingProduct.id)
            .eq("organisation_id", activeOrganisationId);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("products").insert({
            code: row.code,
            name: row.name,
            category_id: category.id,
            organisation_id: activeOrganisationId,
            created_by: user.id,
            user_id: user.id,
          });
          if (error) throw error;
        }
      }

      setToast({ tone: "ok", text: `Imported ${rows.length} catalogue rows.` });
      await loadAll(selectedSessionId);
    } catch {
      setToast({
        tone: "error",
        text: "Could not import the catalogue. Check the template format and try again.",
      });
    }
  }

  async function wipeAllData() {
    if (!supabase || !user || !activeOrganisationId) return;
    if (!canManageCatalogue) {
      setToast({ tone: "error", text: "Only organisation admins can wipe shared data." });
      return;
    }
    const warned = window.confirm(
      "Warning: this will permanently delete all stocktake sessions, entries, products, and categories. Continue?",
    );
    if (!warned) return;

    const confirmation = window.prompt(
      'This deletes all sessions, entries, products, and categories. Type "WIPE" to continue.',
    );
    if (confirmation !== "WIPE") return;

    const entryDelete = await supabase
      .from("stocktake_entries")
      .delete()
      .eq("organisation_id", activeOrganisationId);
    if (entryDelete.error) {
      setToast({ tone: "error", text: "Could not delete stocktake entries." });
      return;
    }
    const sessionDelete = await supabase
      .from("stocktake_sessions")
      .delete()
      .eq("organisation_id", activeOrganisationId);
    if (sessionDelete.error) {
      setToast({ tone: "error", text: "Could not delete stocktake sessions." });
      return;
    }
    const productDelete = await supabase
      .from("products")
      .delete()
      .eq("organisation_id", activeOrganisationId);
    if (productDelete.error) {
      setToast({ tone: "error", text: "Could not delete products." });
      return;
    }
    const categoryDelete = await supabase
      .from("categories")
      .delete()
      .eq("organisation_id", activeOrganisationId);
    if (categoryDelete.error) {
      setToast({ tone: "error", text: "Could not delete categories." });
      return;
    }

    setSelectedSessionId("");
    setEntries([]);
    setToast({ tone: "ok", text: "All demo data wiped. Import a catalogue or add products." });
    await loadAll("");
  }

  async function addOrganisationMember(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !user || !activeOrganisationId || !canManageMembers) return;
    const email = memberEmail.trim().toLowerCase();
    if (!email.includes("@")) {
      setToast({ tone: "error", text: "Enter a valid member email address." });
      return;
    }

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("id,email")
      .eq("email", email)
      .maybeSingle();

    const { error } = await supabase.from("organisation_members").insert({
      organisation_id: activeOrganisationId,
      user_id: profile?.id ?? null,
      invited_email: email,
      role: memberRole,
      status: profile?.id ? "active" : "pending",
    });

    if (error) {
      setToast({ tone: "error", text: "Could not add member. They may already be listed." });
      return;
    }

    setMemberEmail("");
    setMemberRole("warehouse_staff");
    setToast({
      tone: "ok",
      text: profile?.id
        ? "Member added to this organisation."
        : "Member invitation prepared. They will join this organisation after sign-up.",
    });
    await loadOrganisationContext();
  }

  async function recordExport(exportType: string) {
    if (!supabase || !user || !activeOrganisationId) return;
    await supabase.from("erp_exports").insert({
      organisation_id: activeOrganisationId,
      session_id: selectedSessionId || null,
      generated_by_user_id: user.id,
      export_type: exportType,
    });
  }

  const displayUsername =
    userProfile?.display_name ||
    userProfile?.username ||
    normaliseUsername(String(user?.user_metadata?.username ?? "")) ||
    (user ? `user_${user.id.slice(0, 8)}` : "");

  function selectNavigationMode(nextMode: NavMode) {
    setMode(nextMode);
    setMobileNavOpen(false);
  }

  return (
    <>
      {user && (
        <NavigationMenu
          activeMode={mode}
          canManageOrganisation={canManageMembers}
          onSelect={selectNavigationMode}
          variant="desktop"
        />
      )}
      {user && mobileNavOpen && (
        <div
          aria-label="Stocktake navigation"
          aria-modal="true"
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
        >
          <div
            className="absolute inset-0 h-full w-full cursor-default bg-stone-950/45"
            onClick={() => setMobileNavOpen(false)}
            role="presentation"
          />
          <NavigationMenu
            activeMode={mode}
            canManageOrganisation={canManageMembers}
            displayUsername={displayUsername}
            organisationName={activeOrganisation?.name}
            onClose={() => setMobileNavOpen(false)}
            onSelect={selectNavigationMode}
            onSignOut={() => {
              setMobileNavOpen(false);
              signOut();
            }}
            variant="mobile"
          />
        </div>
      )}

      <div className={user ? "lg:pl-72" : undefined}>
        <main className="mx-auto flex min-h-screen w-full max-w-[112rem] flex-col gap-4 px-4 py-5 sm:px-6">
          <header className="flex flex-col gap-3 border-b border-stone-300 pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-start gap-3">
              {user && (
                <button
                  aria-controls="mobile-stocktake-navigation"
                  aria-expanded={mobileNavOpen}
                  aria-label="Open navigation"
                  className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded border border-stone-300 bg-white text-stone-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 lg:hidden"
                  onClick={() => setMobileNavOpen(true)}
                  type="button"
                >
                  <MenuIcon className="h-5 w-5" />
                </button>
              )}
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-800">
                  Skya Stocktake
                </p>
                {user && activeOrganisation && (
                  <p className="mt-1 text-xs font-semibold text-stone-600 lg:hidden">
                    {displayUsername} · {activeOrganisation.name}
                  </p>
                )}
              </div>
            </div>
            <div className="hidden flex-wrap items-center gap-2 lg:flex">
              {user && (
                <span className="rounded border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700">
                  {displayUsername}
                </span>
              )}
              {user && (
                <button
                  className="rounded border border-stone-300 bg-white px-3 py-2 text-sm font-black text-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
                  onClick={signOut}
                  type="button"
                >
                  Sign Out
                </button>
              )}
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

      {authLoading ? (
        <Skeleton label="Checking sign in" />
      ) : !user ? (
        <AuthPanel
          authEmail={authEmail}
          authMode={authMode}
          authPassword={authPassword}
          authUsername={authUsername}
          disabled={saving || !supabaseConfigured}
          onEmail={setAuthEmail}
          onMode={setAuthMode}
          onPassword={setAuthPassword}
          onSubmit={handleAuth}
          onUsername={setAuthUsername}
        />
      ) : loading ? (
        <Skeleton label="Loading organisation data" />
      ) : !activeOrganisation ? (
        <section className="rounded border border-amber-300 bg-amber-50 p-4 text-amber-950">
          <h2 className="text-xl font-black">No organisation access</h2>
          <p className="mt-2 text-sm font-semibold">
            Your account is signed in, but it is not linked to an active organisation.
            Ask an organisation admin to add your email, then sign out and sign in again.
          </p>
        </section>
      ) : (
      <section className="grid gap-4 2xl:grid-cols-[300px_1fr]">
        <aside className="hidden space-y-4 lg:block">
          <div className="rounded border border-stone-300 bg-white p-3">
            <h2 className="text-sm font-black uppercase text-stone-800">Sessions</h2>
            <form className="mt-3 grid gap-2 md:grid-cols-[180px_1fr_auto]" onSubmit={createSession}>
              <select
                aria-label="Session preset"
                className="rounded border border-stone-300 px-3 py-2"
                onChange={(event) => setNewSessionName(event.target.value)}
                value={SESSION_PRESETS.includes(newSessionName) ? newSessionName : ""}
              >
                <option value="">Session type</option>
                {SESSION_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset}
                  </option>
                ))}
              </select>
              <input
                className="min-w-0 rounded border border-stone-300 px-3 py-2"
                placeholder="Custom session"
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
          {mode === "count" && (
            <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_420px]">
              <section className="rounded border border-stone-300 bg-white p-4 shadow-sm lg:shadow-none">
                <div className="mb-4 rounded border border-stone-200 bg-stone-50 p-3 lg:hidden">
                  <label className="text-xs font-bold uppercase text-stone-600" htmlFor="mobile-session">
                    Current session
                  </label>
                  <select
                    className="mt-1 h-12 w-full rounded border border-stone-300 bg-white px-3 text-base font-bold text-stone-950 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
                    id="mobile-session"
                    onChange={(event) => setSelectedSessionId(event.target.value)}
                    value={selectedSessionId}
                  >
                    <option value="">Select a session</option>
                    {sessions.map((session) => (
                      <option key={session.id} value={session.id}>
                        {session.name}
                      </option>
                    ))}
                  </select>
                  <form className="mt-3 grid gap-2" onSubmit={createSession}>
                    <select
                      aria-label="Session preset"
                      className="h-12 rounded border border-stone-300 bg-white px-3 text-base text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
                      onChange={(event) => setNewSessionName(event.target.value)}
                      value={SESSION_PRESETS.includes(newSessionName) ? newSessionName : ""}
                    >
                      <option value="">Session type</option>
                      {SESSION_PRESETS.map((preset) => (
                        <option key={preset} value={preset}>
                          {preset}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label="Custom session name"
                      className="h-12 rounded border border-stone-300 px-3 text-base focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
                      placeholder="Custom session"
                      value={newSessionName}
                      onChange={(event) => setNewSessionName(event.target.value)}
                    />
                    <button className="h-12 rounded bg-emerald-800 px-4 text-base font-black text-white focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2">
                      Add Session
                    </button>
                  </form>
                </div>
                <h2 className="text-xl font-black text-stone-950">
                  {selectedSession?.name ?? "Select a session"}
                </h2>
                {!selectedSessionId && (
                  <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                    Add or select a session before saving a count.
                  </p>
                )}
                <form className="mt-4 grid gap-4 xl:grid-cols-[minmax(180px,1fr)_160px_minmax(160px,220px)_auto]" onSubmit={saveEntry}>
                  <div>
                    <label className="text-sm font-black uppercase text-stone-700" htmlFor="count-product-code">Product code</label>
                    <input
                      className="mt-2 h-14 w-full rounded border border-stone-300 px-4 text-xl font-black uppercase text-stone-950 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 xl:text-lg"
                      id="count-product-code"
                      inputMode="text"
                      placeholder="WH-0042"
                      ref={productCodeInputRef}
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
                    <label className="text-sm font-black uppercase text-stone-700" htmlFor="count-quantity">Count quantity</label>
                    <input
                      className="mt-2 h-14 w-full rounded border border-stone-300 px-4 text-xl font-black text-stone-950 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 xl:text-lg"
                      id="count-quantity"
                      inputMode="numeric"
                      min={0}
                      type="number"
                      value={countInput}
                      onChange={(event) => setCountInput(event.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-black uppercase text-stone-700" htmlFor="count-location">Location</label>
                    <input
                      className="mt-2 h-14 w-full rounded border border-stone-300 px-4 text-lg font-bold text-stone-950 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
                      id="count-location"
                      placeholder="Optional"
                      value={locationInput}
                      onChange={(event) => setLocationInput(event.target.value)}
                    />
                  </div>
                  <button
                    aria-label="Save entry"
                    className="h-14 w-full rounded bg-emerald-800 px-5 text-lg font-black text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 xl:w-auto xl:self-end xl:text-base"
                    disabled={!selectedSessionId || saving}
                  >
                    {saving ? "Saving" : selectedSessionId ? (
                      <>
                        <span className="xl:hidden">Save Entry</span>
                        <span className="hidden xl:inline">Save</span>
                      </>
                    ) : "Select session first"}
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
              onExport={recordExport}
            />
          )}

          {mode === "catalogue" && (
            <Catalogue
              catalogueDraft={catalogueDraft}
              canManageCatalogue={canManageCatalogue}
              categories={categories}
              categoryName={categoryName}
              products={products}
              onAddCategory={addCategory}
              onAddProduct={(event) => addProduct(event, false)}
              onCategoryName={setCategoryName}
              onDraft={setCatalogueDraft}
              onDownloadTemplate={downloadCatalogueTemplate}
              onImportClick={() => importInputRef.current?.click()}
              onImportTemplate={importCatalogueTemplate}
              onRenameCategory={renameCategory}
              onUpdateProduct={updateProduct}
              onWipeAllData={wipeAllData}
              importInputRef={importInputRef}
            />
          )}

          {mode === "organisation" && (
            <OrganisationPanel
              activeOrganisation={activeOrganisation}
              activeOrganisationId={activeOrganisationId}
              activeRole={activeRole}
              canManageMembers={canManageMembers}
              memberEmail={memberEmail}
              memberRole={memberRole}
              members={organisationMembers}
              organisations={organisations}
              onAddMember={addOrganisationMember}
              onMemberEmail={setMemberEmail}
              onMemberRole={setMemberRole}
              onOrganisationChange={setActiveOrganisationId}
            />
          )}
        </section>
      </section>
      )}
        </main>
      </div>
    </>
  );
}

function NavigationMenu({
  activeMode,
  canManageOrganisation,
  displayUsername,
  organisationName,
  onClose,
  onSelect,
  onSignOut,
  variant,
}: {
  activeMode: NavMode;
  canManageOrganisation: boolean;
  displayUsername?: string;
  organisationName?: string;
  onClose?: () => void;
  onSelect: (mode: NavMode) => void;
  onSignOut?: () => void;
  variant: "desktop" | "mobile";
}) {
  const isMobile = variant === "mobile";
  const visibleItems = NAV_ITEMS.filter(
    (item) => item.id !== "organisation" || (!isMobile && canManageOrganisation),
  );

  return (
    <aside
      className={
        isMobile
          ? "relative z-10 flex h-full w-80 max-w-[86vw] flex-col border-r border-stone-300 bg-stone-50 shadow-2xl"
          : "fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-stone-300 bg-stone-50/95 shadow-sm lg:flex"
      }
      id={isMobile ? "mobile-stocktake-navigation" : "desktop-stocktake-navigation"}
    >
      <div className="flex items-start justify-between border-b border-stone-300 p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-800">
            Skya Stocktake
          </p>
          <p className="mt-2 text-lg font-black text-stone-950">Navigation</p>
        </div>
        {isMobile && (
          <button
            aria-label="Close navigation"
            className="inline-flex h-10 w-10 items-center justify-center rounded border border-stone-300 bg-white text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            onClick={onClose}
            type="button"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        )}
      </div>
      <nav aria-label="Stocktake sections" className="flex-1 space-y-2 p-4">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const active = activeMode === item.id;

          return (
            <button
              aria-current={active ? "page" : undefined}
              className={`flex w-full items-center gap-3 rounded border px-3 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 ${
                active
                  ? "border-emerald-800 bg-emerald-50 text-emerald-950"
                  : "border-transparent bg-transparent text-stone-700 hover:border-stone-300 hover:bg-white"
              }`}
              key={item.id}
              onClick={() => onSelect(item.id)}
              type="button"
            >
              <span
                className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded border ${
                  active
                    ? "border-emerald-800 bg-emerald-800 text-white"
                    : "border-stone-300 bg-white text-stone-700"
                }`}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-black">{item.label}</span>
                <span className="block text-xs font-semibold text-stone-500">
                  {item.description}
                </span>
              </span>
            </button>
          );
        })}
      </nav>
      {isMobile && (
        <div className="border-t border-stone-300 p-4">
          <div className="rounded border border-stone-300 bg-white p-3">
            <p className="text-xs font-bold uppercase text-stone-500">Account</p>
            <p className="mt-1 text-base font-black text-stone-950">
              {displayUsername}
            </p>
            {organisationName && (
              <p className="mt-1 text-sm font-semibold text-stone-600">{organisationName}</p>
            )}
          </div>
          <button
            className="mt-3 h-12 w-full rounded border border-stone-300 bg-white px-4 text-base font-black text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            onClick={onSignOut}
            type="button"
          >
            Sign Out
          </button>
        </div>
      )}
    </aside>
  );
}

function MenuIcon({ className }: NavIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon({ className }: NavIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function ClipboardIcon({ className }: NavIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M9 5h6M9 4a2 2 0 0 0-2 2v1h10V6a2 2 0 0 0-2-2" />
      <path d="M7 7H5v13h14V7h-2M8 13h8M8 17h5" />
    </svg>
  );
}

function ChartIcon({ className }: NavIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M4 19V5M4 19h16" />
      <path d="M8 16v-5M12 16V8M16 16v-7" />
    </svg>
  );
}

function BoxesIcon({ className }: NavIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="m12 3 7 4-7 4-7-4 7-4Z" />
      <path d="m5 12 7 4 7-4M5 17l7 4 7-4" />
    </svg>
  );
}

function BuildingIcon({ className }: NavIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M4 21h16M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
      <path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1" />
    </svg>
  );
}

function AuthPanel({
  authEmail,
  authMode,
  authPassword,
  authUsername,
  disabled,
  onEmail,
  onMode,
  onPassword,
  onSubmit,
  onUsername,
}: {
  authEmail: string;
  authMode: "sign-in" | "sign-up";
  authPassword: string;
  authUsername: string;
  disabled: boolean;
  onEmail: (value: string) => void;
  onMode: (value: "sign-in" | "sign-up") => void;
  onPassword: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onUsername: (value: string) => void;
}) {
  return (
    <section className="mx-auto w-full max-w-md rounded border border-stone-300 bg-white p-5">
      <h2 className="text-2xl font-black text-stone-950">
        {authMode === "sign-in" ? "Sign in" : "Create account"}
      </h2>
      <p className="mt-1 text-sm text-stone-600">
        {authMode === "sign-in"
          ? "Use your username or email and password to access your private stocktake data."
          : "Choose a username, then confirm your email before signing in."}
      </p>
      <form className="mt-5 space-y-3" onSubmit={onSubmit}>
        {authMode === "sign-up" && (
          <div>
            <label className="text-xs font-bold uppercase text-stone-600">Username</label>
            <input
              autoComplete="username"
              className="mt-1 w-full rounded border border-stone-300 px-3 py-3"
              onChange={(event) => onUsername(event.target.value)}
              pattern="[A-Za-z0-9_]{3,30}"
              placeholder="warehouse_admin"
              value={authUsername}
            />
          </div>
        )}
        <div>
          <label className="text-xs font-bold uppercase text-stone-600">
            {authMode === "sign-in" ? "Username or email" : "Email"}
          </label>
          <input
            autoComplete={authMode === "sign-in" ? "username" : "email"}
            className="mt-1 w-full rounded border border-stone-300 px-3 py-3"
            onChange={(event) => onEmail(event.target.value)}
            type={authMode === "sign-in" ? "text" : "email"}
            value={authEmail}
          />
        </div>
        <div>
          <label className="text-xs font-bold uppercase text-stone-600">Password</label>
          <input
            autoComplete={authMode === "sign-in" ? "current-password" : "new-password"}
            className="mt-1 w-full rounded border border-stone-300 px-3 py-3"
            minLength={6}
            onChange={(event) => onPassword(event.target.value)}
            type="password"
            value={authPassword}
          />
        </div>
        <button
          className="w-full rounded bg-emerald-800 px-4 py-3 font-black text-white"
          disabled={disabled}
        >
          {authMode === "sign-in" ? "Sign In" : "Create Account"}
        </button>
      </form>
      <button
        className="mt-4 w-full rounded border border-stone-300 bg-white px-4 py-3 text-sm font-black text-stone-800"
        onClick={() => onMode(authMode === "sign-in" ? "sign-up" : "sign-in")}
        type="button"
      >
        {authMode === "sign-in"
          ? "Need an account? Create one"
          : "Already have an account? Sign in"}
      </button>
    </section>
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
      <h2 className="text-lg font-black text-stone-950">Recent entries</h2>
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
                  <p className="text-sm text-stone-600">
                    Location: {entry.location || "Not set"}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-stone-500">
                    Saved {formatDateTime(entry.created_at)}
                  </p>
                </div>
                <p className="text-3xl font-black text-stone-950 xl:text-2xl">{entry.count}</p>
              </div>
              {editingEntryId === entry.id ? (
                <div className="mt-3 grid gap-2 sm:flex">
                  <input
                    aria-label="Edit count quantity"
                    className="h-12 w-full rounded border border-stone-300 px-3 font-bold focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 sm:w-28"
                    min={0}
                    type="number"
                    value={editingCount}
                    onChange={(event) => onEditingCount(event.target.value)}
                  />
                  <button
                    className="h-12 rounded bg-emerald-800 px-4 font-bold text-white focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
                    onClick={() => onSaveEdit(entry.id)}
                  >
                    Save
                  </button>
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:flex">
                  <button
                    className="h-12 rounded border border-stone-300 bg-white px-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
                    onClick={() => onEdit(entry)}
                  >
                    Edit
                  </button>
                  <button
                    className="h-12 rounded border border-red-300 bg-white px-3 text-sm font-bold text-red-700 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
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

function OrganisationPanel({
  activeOrganisation,
  activeOrganisationId,
  activeRole,
  canManageMembers,
  memberEmail,
  memberRole,
  members,
  organisations,
  onAddMember,
  onMemberEmail,
  onMemberRole,
  onOrganisationChange,
}: {
  activeOrganisation: Organisation;
  activeOrganisationId: string;
  activeRole: OrganisationRole | null;
  canManageMembers: boolean;
  memberEmail: string;
  memberRole: OrganisationRole;
  members: OrganisationMember[];
  organisations: Organisation[];
  onAddMember: (event: FormEvent) => void;
  onMemberEmail: (value: string) => void;
  onMemberRole: (value: OrganisationRole) => void;
  onOrganisationChange: (value: string) => void;
}) {
  const activeMembers = members.filter(
    (member) => member.organisation_id === activeOrganisationId,
  );

  return (
    <section className="rounded border border-stone-300 bg-white p-4">
      <div className="border-b border-stone-200 pb-4">
        <h2 className="text-2xl font-black text-stone-950">Organisation</h2>
        <p className="mt-1 text-sm font-semibold text-stone-600">
          {activeOrganisation.name} · Your role:{" "}
          <span className="capitalize">{activeRole?.replace("_", " ") ?? "member"}</span>
        </p>
      </div>

      {organisations.length > 1 && (
        <div className="mt-4 max-w-md">
          <label className="text-xs font-bold uppercase text-stone-600" htmlFor="organisation-switcher">
            Active organisation
          </label>
          <select
            className="mt-1 w-full rounded border border-stone-300 bg-white px-3 py-3 font-semibold text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            id="organisation-switcher"
            onChange={(event) => onOrganisationChange(event.target.value)}
            value={activeOrganisationId}
          >
            {organisations.map((organisation) => (
              <option key={organisation.id} value={organisation.id}>
                {organisation.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {!canManageMembers && (
        <p className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
          Organisation settings are managed by office staff. Warehouse staff can continue
          counting stock from the Count page.
        </p>
      )}

      {canManageMembers && (
        <form className="mt-4 grid gap-2 lg:grid-cols-[minmax(220px,1fr)_220px_auto]" onSubmit={onAddMember}>
          <input
            className="rounded border border-stone-300 px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            placeholder="member@email.com"
            type="email"
            value={memberEmail}
            onChange={(event) => onMemberEmail(event.target.value)}
          />
          <select
            className="rounded border border-stone-300 px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            value={memberRole}
            onChange={(event) => onMemberRole(event.target.value as OrganisationRole)}
          >
            <option value="warehouse_staff">Warehouse staff</option>
            <option value="supervisor">Supervisor</option>
            <option value="admin">Admin</option>
          </select>
          <button className="rounded bg-emerald-800 px-4 py-3 text-sm font-black text-white focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2">
            Add Member
          </button>
        </form>
      )}

      <div className="mt-4 divide-y divide-stone-200 rounded border border-stone-200">
        {activeMembers.length === 0 && (
          <p className="p-3 text-sm text-stone-600">No members listed yet.</p>
        )}
        {activeMembers.map((member) => (
          <div className="grid gap-1 p-3 text-sm md:grid-cols-[1fr_160px_120px]" key={member.id}>
            <p className="font-bold text-stone-950">
              {member.invited_email || member.user_id || "Member"}
            </p>
            <p className="capitalize text-stone-600">{member.role.replace("_", " ")}</p>
            <p className="uppercase text-stone-500">{member.status}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Report({
  generatedAt,
  groups,
  onExport,
  session,
}: {
  generatedAt: Date;
  groups: [string, { total: number; rows: Entry[] }][];
  onExport: (exportType: string) => void;
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
      location: entry.location ?? "",
      name: entry.products?.name ?? "",
      count: entry.count,
      savedAt: formatDateTime(entry.created_at),
    })),
  );

  function exportCsv() {
    onExport("csv");
    const rows = [
      ["Session", sessionName],
      ["Generated", generatedStamp],
      [],
      ["Category", "Product Code", "Product Name", "Location", "Count", "Saved At"],
      ...rowData.map((row) => [
        row.category,
        row.code,
        row.name,
        row.location,
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
    onExport("excel");
    const bodyRows = rowData
      .map(
        (row) => `
          <tr>
            <td>${htmlCell(row.category)}</td>
            <td>${htmlCell(row.code)}</td>
            <td>${htmlCell(row.name)}</td>
            <td>${htmlCell(row.location || "Not set")}</td>
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
            <tr><th colspan="6">Skya Stocktake Report</th></tr>
            <tr><td>Session</td><td colspan="5">${htmlCell(sessionName)}</td></tr>
            <tr><td>Generated</td><td colspan="5">${htmlCell(generatedStamp)}</td></tr>
            <tr></tr>
            <tr>
              <th>Category</th>
              <th>Product Code</th>
              <th>Product Name</th>
              <th>Location</th>
              <th>Count</th>
              <th>Saved At</th>
            </tr>
            ${bodyRows}
            <tr></tr>
            <tr><td>Total Units</td><td colspan="5">${htmlCell(totalUnits)}</td></tr>
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
                  <th>Location</th>
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
                        <td>${htmlCell(entry.location || "Not set")}</td>
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
            td:nth-child(4), th:nth-child(4) { text-align: right; }
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
    onExport(mode);
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
                  className="grid grid-cols-[90px_1fr_100px_70px] gap-2 px-3 py-2 text-sm"
                  key={entry.id}
                >
                  <span className="font-black">{entry.products?.code}</span>
                  <span>
                    <span className="block">{entry.products?.name}</span>
                    <span className="block text-xs font-semibold text-stone-500">
                      Saved {formatDateTime(entry.created_at)}
                    </span>
                  </span>
                  <span className="font-semibold text-stone-600">
                    {entry.location || "Not set"}
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
  canManageCatalogue,
  categories,
  categoryName,
  importInputRef,
  products,
  onAddCategory,
  onAddProduct,
  onCategoryName,
  onDownloadTemplate,
  onDraft,
  onImportClick,
  onImportTemplate,
  onRenameCategory,
  onUpdateProduct,
  onWipeAllData,
}: {
  catalogueDraft: { code: string; name: string; category_id: string };
  canManageCatalogue: boolean;
  categories: Category[];
  categoryName: string;
  importInputRef: RefObject<HTMLInputElement | null>;
  products: Product[];
  onAddCategory: (event: FormEvent) => void;
  onAddProduct: (event: FormEvent) => void;
  onCategoryName: (value: string) => void;
  onDownloadTemplate: () => void;
  onDraft: (value: {
    code: string;
    name: string;
    category_id: string;
  }) => void;
  onImportClick: () => void;
  onImportTemplate: (event: ChangeEvent<HTMLInputElement>) => void;
  onRenameCategory: (category: Category, name: string) => void;
  onUpdateProduct: (product: Product, patch: Partial<Product>) => void;
  onWipeAllData: () => void;
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <div className="rounded border border-stone-300 bg-white p-4">
        <div className="flex flex-col gap-3 border-b border-stone-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-xl font-black text-stone-950">Product Catalogue</h2>
            <p className="mt-1 text-sm text-stone-600">
              Import columns: Product Code, Product Name, Category.
            </p>
            {!canManageCatalogue && (
              <p className="mt-1 text-xs font-semibold text-amber-800">
                View only. Ask an organisation admin to manage catalogue data.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded border border-stone-300 bg-white px-3 py-2 text-sm font-black"
              onClick={onDownloadTemplate}
              type="button"
            >
              Download Template
            </button>
            <button
              className="rounded border border-stone-300 bg-white px-3 py-2 text-sm font-black"
              disabled={!canManageCatalogue}
              onClick={onImportClick}
              type="button"
            >
              Import Template
            </button>
            <button
              className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm font-black text-red-800"
              disabled={!canManageCatalogue}
              onClick={onWipeAllData}
              type="button"
            >
              Wipe All Data
            </button>
          </div>
          <input
            accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="hidden"
            onChange={onImportTemplate}
            ref={importInputRef}
            type="file"
          />
        </div>
        <form className="mt-4 grid gap-2 md:grid-cols-[140px_1fr_190px_auto]" onSubmit={onAddProduct}>
          <input
            className="rounded border border-stone-300 px-3 py-2 uppercase"
            disabled={!canManageCatalogue}
            placeholder="Code"
            value={catalogueDraft.code}
            onChange={(event) => onDraft({ ...catalogueDraft, code: event.target.value })}
          />
          <input
            className="rounded border border-stone-300 px-3 py-2"
            disabled={!canManageCatalogue}
            placeholder="Product name"
            value={catalogueDraft.name}
            onChange={(event) => onDraft({ ...catalogueDraft, name: event.target.value })}
          />
          <select
            className="rounded border border-stone-300 px-3 py-2"
            disabled={!canManageCatalogue}
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
          <button
            className="rounded bg-emerald-800 px-3 py-2 font-black text-white disabled:bg-stone-400"
            disabled={!canManageCatalogue}
          >
            Add
          </button>
        </form>
        <div className="mt-4 divide-y divide-stone-200 rounded border border-stone-200">
          {products.map((product) => (
            <div className="grid gap-2 p-3 md:grid-cols-[120px_1fr_190px]" key={product.id}>
              <input
                className="rounded border border-stone-300 px-2 py-2 font-bold uppercase"
                defaultValue={product.code}
                disabled={!canManageCatalogue}
                onBlur={(event) =>
                  onUpdateProduct(product, { code: normaliseProductCode(event.target.value) })
                }
              />
              <input
                className="rounded border border-stone-300 px-2 py-2"
                defaultValue={product.name}
                disabled={!canManageCatalogue}
                onBlur={(event) => onUpdateProduct(product, { name: event.target.value })}
              />
              <select
                className="rounded border border-stone-300 px-2 py-2"
                defaultValue={product.category_id ?? ""}
                disabled={!canManageCatalogue}
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
            disabled={!canManageCatalogue}
            placeholder="New category"
            value={categoryName}
            onChange={(event) => onCategoryName(event.target.value)}
          />
          <button
            className="rounded bg-emerald-800 px-3 py-2 font-black text-white disabled:bg-stone-400"
            disabled={!canManageCatalogue}
          >
            Add
          </button>
        </form>
        <div className="mt-4 space-y-2">
          {categories.map((category) => (
            <input
              className="w-full rounded border border-stone-300 px-3 py-2"
              defaultValue={category.name}
              disabled={!canManageCatalogue}
              key={category.id}
              onBlur={(event) => onRenameCategory(category, event.target.value)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
