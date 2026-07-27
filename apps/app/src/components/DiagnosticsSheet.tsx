'use client';

import { useCallback, useEffect, useState } from 'react';
import { useDiagnostics } from '../hooks/useSync';
import { storageReport, type StorageReport } from '../sync/storage';

/**
 * What makes a stuck queue debuggable from a barn (Observability rubric).
 *
 * Everything here is readable with no network: queue depth, last sync, last
 * error, device id, storage headroom, and the integrity check. The copy
 * button exists because reading a device id aloud over a phone is how
 * diagnostics actually fail.
 */

function when(ts: number | null): string {
  if (ts === null) return 'never';
  const seconds = Math.round((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return new Date(ts).toLocaleString();
}

function megabytes(bytes: number | null): string {
  return bytes === null ? 'unknown' : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function DiagnosticsSheet({ onClose }: { onClose: () => void }): React.ReactElement {
  const report = useDiagnostics(true);
  const [storage, setStorage] = useState<StorageReport | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void storageReport().then(setStorage);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copyDiagnostics = useCallback(() => {
    const text = JSON.stringify({ sync: report, storage, at: new Date().toISOString() }, null, 2);
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    });
  }, [report, storage]);

  return (
    <div className="sheet__scrim" role="dialog" aria-modal="true" aria-label="Sync diagnostics">
      <div className="sheet arch">
        <p className="label">Sync</p>

        <dl className="sheet__rows" data-numeric>
          <dt>Connection</dt>
          <dd>{report?.online ? 'Online' : 'Offline'}</dd>

          <dt>Waiting to send</dt>
          <dd>{report?.queued ?? '—'}</dd>

          <dt>Need a look</dt>
          <dd>{report?.rejected ?? '—'}</dd>

          <dt>Last sent</dt>
          <dd>{report ? when(report.lastSyncAt) : '—'}</dd>

          <dt>Caught up to</dt>
          <dd>{report ? when(report.pulledThrough || null) : '—'}</dd>

          <dt>Storage used</dt>
          <dd>{storage ? megabytes(storage.usageBytes) : '—'}</dd>

          <dt>Protected from clearing</dt>
          <dd>{storage?.persisted ? 'Yes' : 'No'}</dd>

          <dt>Device</dt>
          <dd className="sheet__id">{report?.deviceId ?? '—'}</dd>
        </dl>

        {report && report.quarantined > 0 ? (
          <p className="sheet__warn">
            {report.quarantined} stored {report.quarantined === 1 ? 'entry' : 'entries'} could not
            be read back and {report.quarantined === 1 ? 'was' : 'were'} set aside. Copy
            diagnostics before clearing this device.
          </p>
        ) : null}

        {report?.lastError ? <p className="sheet__error">{report.lastError}</p> : null}

        {storage?.atRisk && storage.reason ? (
          <p className="sheet__warn">{storage.reason}</p>
        ) : null}

        {report && report.integrity.missing > 0 ? (
          <p className="sheet__error">
            {report.integrity.missing} logged {report.integrity.missing === 1 ? 'entry' : 'entries'}{' '}
            went missing from this device before they were sent. Anything already sent is safe on
            the server.
          </p>
        ) : null}

        <div className="sheet__actions">
          <button type="button" className="sheet__button" onClick={copyDiagnostics}>
            {copied ? 'Copied' : 'Copy diagnostics'}
          </button>
          <button type="button" className="sheet__button sheet__button--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
