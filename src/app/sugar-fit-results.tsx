"use client";

import { useEffect, useState } from "react";
import type { Detection } from "@/lib/contracts/scan";
import type { DetectionGroup } from "@/lib/scan/deduplicate-detections";
import { calculateSugarFit, inferProductCategory, type SugarFitResult } from "@/lib/scoring/sugar-fit";

type SheetProps = {
  groups: DetectionGroup[];
  frozenImage: string | null;
  selectedId: string | null;
  recoveryBanner: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
  onScanAgain: () => void;
  onRecommendationOpen: () => void;
};

function displayIdentity(detection: Detection) {
  const brand = detection.product?.brand ?? detection.visualCandidate.brand;
  const name = detection.visualCandidate.name ?? detection.product?.name;
  if (!brand && !name) return "Unidentified product";
  if (!brand) return name ?? "Unidentified product";
  if (!name || name.toLowerCase().includes(brand.toLowerCase())) return name ?? brand;
  return `${brand} ${name}`;
}

function productMeta(detection: Detection) {
  const brand = detection.product?.brand ?? detection.visualCandidate.brand;
  const name = detection.product?.name ?? detection.visualCandidate.name;
  const category = inferProductCategory({ brand, name });
  const packSize = detection.product?.packSize ?? detection.visualCandidate.packSize;
  return [category, packSize].filter(Boolean).join(" · ");
}

function amazonUrl(detection: Detection) {
  const query = [displayIdentity(detection), detection.product?.packSize ?? detection.visualCandidate.packSize].filter(Boolean).join(" ");
  return `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
}

function ScannedProductPhoto({ detection, frozenImage, compact, title }: { detection: Detection; frozenImage: string; compact: boolean; title: string }) {
  const [crop, setCrop] = useState<{ id: string; url: string } | null>(null);
  const { box } = detection;

  useEffect(() => {
    let cancelled = false;
    const source = new Image();
    source.onload = () => {
      if (cancelled || source.naturalWidth < 1 || source.naturalHeight < 1) return;
      const paddingX = box.width * .06;
      const paddingY = box.height * .06;
      const left = Math.max(0, box.x - paddingX);
      const top = Math.max(0, box.y - paddingY);
      const right = Math.min(1, box.x + box.width + paddingX);
      const bottom = Math.min(1, box.y + box.height + paddingY);
      const sourceWidth = Math.max(1, (right - left) * source.naturalWidth);
      const sourceHeight = Math.max(1, (bottom - top) * source.naturalHeight);
      const scale = Math.min(1, 320 / Math.max(sourceWidth, sourceHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(source, left * source.naturalWidth, top * source.naturalHeight, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
      if (!cancelled) setCrop({ id: detection.id, url: canvas.toDataURL("image/jpeg", .86) });
    };
    source.src = frozenImage;
    return () => { cancelled = true; };
  }, [box.height, box.width, box.x, box.y, detection.id, frozenImage]);

  const croppedUrl = crop?.id === detection.id ? crop.url : null;
  return <span className={`sugar-fit-photo crop ${compact ? "compact" : ""}`}>
    {croppedUrl ? <img src={croppedUrl} alt={`${title} from this scan`} /> : <span className="sugar-fit-photo-placeholder" aria-hidden="true">{title.slice(0, 1).toUpperCase()}</span>}
  </span>;
}

function ProductPhoto({ detection, frozenImage, compact = false }: { detection: Detection; frozenImage: string | null; compact?: boolean }) {
  const title = displayIdentity(detection);
  const imageUrl = detection.product?.imageUrl;
  if (imageUrl) return <span className={`sugar-fit-photo ${compact ? "compact" : ""}`}><img src={imageUrl} alt={title} /></span>;
  if (frozenImage) return <ScannedProductPhoto detection={detection} frozenImage={frozenImage} compact={compact} title={title} />;
  return <span className={`sugar-fit-photo fallback ${compact ? "compact" : ""}`} aria-label={title}>{title.slice(0, 1).toUpperCase()}</span>;
}

function CollapseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>;
}

function RightIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>;
}

function BackIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 6-6 6 6 6" /></svg>;
}

function ScoreRing({ fit }: { fit: SugarFitResult }) {
  const style = { "--sugar-fit-progress": `${fit.score}%` } as React.CSSProperties;
  return <div className={`sugar-fit-ring ${fit.tone}`} style={style} role="img" aria-label={`Sugar Fit ${fit.score} out of 100`}><span><strong>{fit.score}</strong><small>SUGAR FIT</small></span></div>;
}

function ProductDetail({ detection, count, frozenImage, recoveryBanner, onBack, onClose, onScanAgain, onRecommendationOpen }: {
  detection: Detection;
  count: number;
  frozenImage: string | null;
  recoveryBanner: string | null;
  onBack: (() => void) | null;
  onClose: () => void;
  onScanAgain: () => void;
  onRecommendationOpen: () => void;
}) {
  const fit = calculateSugarFit({
    sugarPer100g: detection.score.sugarPer100g,
    packSize: detection.product?.packSize ?? detection.visualCandidate.packSize,
    brand: detection.product?.brand ?? detection.visualCandidate.brand,
    name: detection.visualCandidate.name ?? detection.product?.name,
  });
  const dataLabel = detection.status === "confirmed" ? "Verified" : detection.status === "estimate" ? "Estimated" : "Needs verification";

  return <>
    <div className="sugar-fit-sheet-top">
      {onBack ? <button className="sugar-fit-icon-button" onClick={onBack} aria-label="Back to product comparison"><BackIcon /></button> : <span />}
      <span className="sugar-fit-grabber" aria-hidden="true" />
      <button className="sugar-fit-icon-button" onClick={onClose} aria-label="Collapse product details"><CollapseIcon /></button>
    </div>
    {recoveryBanner && <p className="recovery-submission-banner" role="status">{recoveryBanner}</p>}
    <div className="sugar-fit-product-head">
      <ProductPhoto detection={detection} frozenImage={frozenImage} />
      <span className="sugar-fit-product-copy"><strong>{displayIdentity(detection)}</strong><span>{productMeta(detection)}</span></span>
      <span className={`sugar-fit-data-status ${detection.status}`}>{dataLabel}</span>
    </div>
    {fit ? <>
      <div className="sugar-fit-hero">
        <ScoreRing fit={fit} />
        <div className="sugar-fit-hero-copy"><strong>{fit.label}</strong><span>{fit.summary}</span></div>
      </div>
      <div className="sugar-fit-why"><strong>Why this Sugar Fit</strong>{fit.reasons.map((reason) => <span className={fit.tone} key={reason}><i aria-hidden="true">{fit.tone === "green" ? "✓" : "!"}</i>{reason}</span>)}</div>
    </> : <div className="sugar-fit-empty"><strong>No score yet</strong><span>We need verified sugar data to calculate your Sugar Fit.</span></div>}
    {count > 1 && <p className="sugar-fit-repeat">{count} matching products in this scan</p>}
    <button className="sugar-fit-scan-again" onClick={onScanAgain}>Scan another product</button>
    <a className="sugar-fit-amazon" href={amazonUrl(detection)} target="_blank" rel="noreferrer" onClick={onRecommendationOpen}>Find on Amazon ↗</a>
  </>;
}

function ProductComparison({ groups, frozenImage, onSelect, onClose, onScanAgain }: Pick<SheetProps, "groups" | "frozenImage" | "onSelect" | "onClose" | "onScanAgain">) {
  return <>
    <div className="sugar-fit-sheet-top"><span /><span className="sugar-fit-grabber" aria-hidden="true" /><button className="sugar-fit-icon-button" onClick={onClose} aria-label="Collapse product comparison"><CollapseIcon /></button></div>
    <header className="sugar-fit-compare-heading"><strong>Compare your Sugar Fits</strong><span>See what fits your day best.</span></header>
    <div className="sugar-fit-list">{groups.map(({ detection, count }) => {
      const fit = calculateSugarFit({ sugarPer100g: detection.score.sugarPer100g, packSize: detection.product?.packSize ?? detection.visualCandidate.packSize, brand: detection.product?.brand ?? detection.visualCandidate.brand, name: detection.visualCandidate.name ?? detection.product?.name });
      return <button key={detection.id} className="sugar-fit-row" onClick={() => onSelect(detection.id)}>
        <ProductPhoto detection={detection} frozenImage={frozenImage} compact />
        <span className="sugar-fit-row-copy"><strong>{displayIdentity(detection)}</strong><span>{productMeta(detection)}{count > 1 ? ` · ×${count}` : ""}</span></span>
        <span className={`sugar-fit-row-score ${fit?.tone ?? "unknown"}`}><strong>{fit?.score ?? "—"}</strong><small>{fit?.label ?? "No score yet"}</small></span>
        <RightIcon />
      </button>;
    })}</div>
    <button className="sugar-fit-scan-again" onClick={onScanAgain}>Scan another product</button>
  </>;
}

export function SugarFitResultsSheet(props: SheetProps) {
  const selected = props.groups.find(({ detection }) => detection.id === props.selectedId) ?? (props.groups.length === 1 ? props.groups[0] : null);
  return <section className="result-sheet sugar-fit-sheet" aria-label="Sugar Fit results">
    {selected ? <ProductDetail detection={selected.detection} count={selected.count} frozenImage={props.frozenImage} recoveryBanner={props.recoveryBanner} onBack={props.groups.length > 1 ? () => props.onSelect(null) : null} onClose={props.onClose} onScanAgain={props.onScanAgain} onRecommendationOpen={props.onRecommendationOpen} /> : <ProductComparison groups={props.groups} frozenImage={props.frozenImage} onSelect={props.onSelect} onClose={props.onClose} onScanAgain={props.onScanAgain} />}
  </section>;
}

export function SugarFitResultHandle({ groups, frozenImage, onOpen }: { groups: DetectionGroup[]; frozenImage: string | null; onOpen: () => void }) {
  const first = groups[0]?.detection;
  if (!first) return null;
  if (groups.length > 1) return <button className="result-handle sugar-fit-result-handle multi" onClick={onOpen}><span className="sugar-fit-handle-icon" aria-hidden="true"><i /><i /><i /></span><span><strong>{groups.length} products ready</strong><small>Compare Sugar Fits</small></span><span className="sugar-fit-handle-arrow"><RightIcon /></span></button>;
  const fit = calculateSugarFit({ sugarPer100g: first.score.sugarPer100g, packSize: first.product?.packSize ?? first.visualCandidate.packSize, brand: first.product?.brand ?? first.visualCandidate.brand, name: first.visualCandidate.name ?? first.product?.name });
  return <button className="result-handle sugar-fit-result-handle" onClick={onOpen}><ProductPhoto detection={first} frozenImage={frozenImage} compact /><span><strong>{displayIdentity(first)}</strong><small>{fit?.label ?? "No score yet"}</small></span><b className={fit?.tone ?? "unknown"}>{fit?.score ?? "—"}<small>Sugar Fit</small></b><span className="sugar-fit-handle-arrow"><RightIcon /></span></button>;
}
