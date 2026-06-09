'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export type TrainingType = 'weekend' | 'one_to_one' | 'weekday' | 'matchplay';

export interface MakeupSelectionResult {
  usageId: string;
  creditId: string;
  targetTrainingType: TrainingType;
  targetDate: string;
  targetLabel: string;
  targetValue: number;
  creditValue: number;
  topUpAmount: number;
}

interface Props {
  open: boolean;
  sourceTrainingType: TrainingType;
  sourceStudentId: string;
  studentName: string;
  defaultDate?: string;
  onClose: () => void;
  onCompleted: (result: MakeupSelectionResult) => Promise<void> | void;
}

interface CreditResult {
  id: string;
  credit_value: number;
  source_label: string;
  source_date: string;
}

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const LABELS: Record<TrainingType, string> = {
  weekend: 'Weekend',
  one_to_one: '1-1',
  weekday: 'Weekday',
  matchplay: 'MatchPlay',
};

const DEFAULT_VALUES: Record<TrainingType, number> = {
  weekend: 40,
  one_to_one: 80,
  weekday: 80,
  matchplay: 80,
};

const WEEKDAY_HOURLY_RATE = 80;
const WEEKDAY_HOUR_OPTIONS = [1, 2, 3] as const;

const todayKey = () => new Date().toISOString().slice(0, 10);
const money = (value: number) => `S$${Number(value || 0).toFixed(2)}`;

export default function CrossProgrammeMakeupModal({
                                                    open,
                                                    sourceTrainingType,
                                                    sourceStudentId,
                                                    studentName,
                                                    defaultDate,
                                                    onClose,
                                                    onCompleted,
                                                  }: Props) {
  const [credit, setCredit] = useState<CreditResult | null>(null);
  const [targetType, setTargetType] = useState<TrainingType>('weekend');
  const [targetDate, setTargetDate] = useState(defaultDate || todayKey());
  const [targetLabel, setTargetLabel] = useState('Weekend makeup lesson');
  const [targetValue, setTargetValue] = useState(DEFAULT_VALUES.weekend);
  const [weekdayHours, setWeekdayHours] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;

    setTargetType('weekend');
    setTargetDate(defaultDate || todayKey());
    setTargetLabel('Weekend makeup lesson');
    setTargetValue(DEFAULT_VALUES.weekend);
    setWeekdayHours(1);
    setError('');

    const loadCredit = async () => {
      try {
        setLoading(true);

        const { data, error: rpcError } = await supabase.rpc(
            'find_latest_makeup_credit',
            {
              input_source_type: sourceTrainingType,
              input_source_student_id: sourceStudentId,
            }
        );

        if (rpcError) throw rpcError;

        const row = Array.isArray(data) ? data[0] : data;

        if (!row?.id) {
          throw new Error(
              'No available makeup credit was found. Mark the lesson as missed first.'
          );
        }

        setCredit(row as CreditResult);
      } catch (err: any) {
        setCredit(null);
        setError(err?.message || 'Failed to find an available makeup credit.');
      } finally {
        setLoading(false);
      }
    };

    loadCredit();
  }, [open, sourceTrainingType, sourceStudentId, defaultDate]);

  useEffect(() => {
    if (targetType === 'weekday') {
      setTargetValue(weekdayHours * WEEKDAY_HOURLY_RATE);
      setTargetLabel(`Weekday ${weekdayHours}h makeup lesson`);
      return;
    }

    setTargetValue(DEFAULT_VALUES[targetType]);
    setTargetLabel(`${LABELS[targetType]} makeup lesson`);
  }, [targetType, weekdayHours]);

  const topUp = useMemo(() => {
    return Math.max(0, Number(targetValue || 0) - Number(credit?.credit_value || 0));
  }, [targetValue, credit]);

  const confirmMakeup = async () => {
    if (!credit) return;

    try {
      setConfirming(true);
      setError('');

      const { data, error: rpcError } = await supabase.rpc(
          'complete_cross_programme_makeup',
          {
            input_credit_id: credit.id,
            input_target_type: targetType,
            input_target_date: targetDate,
            input_target_label: targetLabel.trim() || `${LABELS[targetType]} makeup lesson`,
            input_target_value: Number(targetValue),
          }
      );

      if (rpcError) throw rpcError;

      const resultRow = Array.isArray(data) ? data[0] : data;

      await onCompleted({
        usageId: String(resultRow.usage_id),
        creditId: credit.id,
        targetTrainingType: targetType,
        targetDate,
        targetLabel: targetLabel.trim() || `${LABELS[targetType]} makeup lesson`,
        targetValue: Number(targetValue),
        creditValue: Number(credit.credit_value),
        topUpAmount: Number(resultRow.top_up_amount || 0),
      });

      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to confirm makeup.');
    } finally {
      setConfirming(false);
    }
  };

  if (!open) return null;

  return (
      <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50000,
            background: 'rgba(15, 23, 42, 0.68)',
            backdropFilter: 'blur(2px)',
            display: 'grid',
            placeItems: 'center',
            padding: 18,
          }}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !confirming) onClose();
          }}
      >
        <div
            style={{
              position: 'relative',
              zIndex: 50001,
              width: 'min(620px, 100%)',
              maxHeight: 'calc(100dvh - 36px)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 20,
              background: '#ffffff',
              boxShadow: '0 28px 70px rgba(15, 23, 42, 0.28)',
              border: '1px solid #dbe4f0',
              boxSizing: 'border-box',
            }}
        >
          <div
              style={{
                flex: '0 0 auto',
                padding: '22px 24px',
                borderBottom: '1px solid #e5e7eb',
                background: '#ffffff',
                position: 'relative',
                zIndex: 2,
              }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
              <div>
                <h2 style={{ margin: 0 }}>Choose Makeup Programme</h2>
                <p style={{ margin: '7px 0 0', color: '#64748b' }}>
                  {studentName} · missed from {LABELS[sourceTrainingType]}
                </p>
              </div>

              <button
                  type="button"
                  onClick={onClose}
                  disabled={confirming}
                  style={{
                    border: 'none',
                    background: '#f1f5f9',
                    borderRadius: 10,
                    width: 38,
                    height: 38,
                    cursor: 'pointer',
                    fontSize: '1.2rem',
                  }}
              >
                ×
              </button>
            </div>
          </div>

          <div
              style={{
                flex: '1 1 auto',
                minHeight: 0,
                overflowY: 'auto',
                overscrollBehavior: 'contain',
                scrollbarGutter: 'stable',
                padding: 24,
                display: 'grid',
                gap: 18,
                background: '#ffffff',
                boxSizing: 'border-box',
              }}
          >
            {error && <div className="error-message">{error}</div>}

            {loading ? (
                <p className="muted">Finding available makeup credit...</p>
            ) : credit ? (
                <>
                  <div
                      style={{
                        border: '1px solid #bfdbfe',
                        background: '#eff6ff',
                        borderRadius: 14,
                        padding: 14,
                      }}
                  >
                    Available credit: <strong>{money(credit.credit_value)}</strong>
                    <div style={{ color: '#64748b', marginTop: 4, fontSize: '0.86rem' }}>
                      {credit.source_label}
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Makeup programme</label>
                    <select
                        className="form-input"
                        value={targetType}
                        onChange={(event) => setTargetType(event.target.value as TrainingType)}
                    >
                      {Object.entries(LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Makeup date</label>
                    <input
                        className="form-input"
                        type="date"
                        value={targetDate}
                        onChange={(event) => setTargetDate(event.target.value)}
                    />
                  </div>

                  {targetType === 'weekday' && (
                      <div className="form-group">
                        <label>Weekday lesson duration</label>
                        <select
                            className="form-input"
                            value={weekdayHours}
                            onChange={(event) =>
                                setWeekdayHours(Number(event.target.value))
                            }
                        >
                          {WEEKDAY_HOUR_OPTIONS.map((hours) => (
                              <option key={hours} value={hours}>
                                {hours} hour{hours === 1 ? '' : 's'} — {money(hours * WEEKDAY_HOURLY_RATE)}
                              </option>
                          ))}
                        </select>

                        <div
                            className="muted"
                            style={{ marginTop: 7, fontSize: '0.85rem' }}
                        >
                          Weekday rate: {money(WEEKDAY_HOURLY_RATE)} per hour
                        </div>
                      </div>
                  )}

                  <div className="form-group">
                    <label>Target lesson label</label>
                    <input
                        className="form-input"
                        value={targetLabel}
                        onChange={(event) => setTargetLabel(event.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>Target lesson value (S$)</label>
                    <input
                        className="form-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={targetValue}
                        onChange={(event) => setTargetValue(Number(event.target.value))}
                        readOnly={targetType === 'weekday'}
                        style={{
                          background:
                              targetType === 'weekday' ? '#f1f5f9' : undefined,
                          cursor:
                              targetType === 'weekday' ? 'not-allowed' : undefined,
                        }}
                    />

                    {targetType === 'weekday' && (
                        <div
                            className="muted"
                            style={{ marginTop: 7, fontSize: '0.85rem' }}
                        >
                          Calculated automatically: {weekdayHours}h × {money(WEEKDAY_HOURLY_RATE)}/h
                        </div>
                    )}
                  </div>

                  <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: 10,
                      }}
                  >
                    <div style={{ background: '#f8fafc', borderRadius: 12, padding: 12 }}>
                      <div className="muted">Credit</div>
                      <strong>{money(credit.credit_value)}</strong>
                    </div>
                    <div style={{ background: '#f8fafc', borderRadius: 12, padding: 12 }}>
                      <div className="muted">Target</div>
                      <strong>{money(targetValue)}</strong>
                    </div>
                    <div style={{ background: topUp > 0 ? '#fff1f2' : '#ecfdf5', borderRadius: 12, padding: 12 }}>
                      <div className="muted">Top-up</div>
                      <strong style={{ color: topUp > 0 ? '#dc2626' : '#047857' }}>
                        {money(topUp)}
                      </strong>
                    </div>
                  </div>

                  <p className="muted" style={{ margin: 0, fontSize: '0.84rem' }}>
                    If the target lesson costs more than the available credit, the difference is charged as a top-up. If it costs less, there is no refund or remaining credit.
                  </p>

                  <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                        gap: 12,
                        width: '100%',
                      }}
                  >
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={confirming}
                        style={{
                          width: '100%',
                          minHeight: 46,
                          border: '1px solid #cbd5e1',
                          borderRadius: 10,
                          padding: '10px 16px',
                          background: '#ffffff',
                          color: '#334155',
                          fontFamily: 'inherit',
                          fontSize: '0.95rem',
                          fontWeight: 800,
                          lineHeight: 1.2,
                          cursor: confirming ? 'not-allowed' : 'pointer',
                          opacity: confirming ? 0.65 : 1,
                          boxSizing: 'border-box',
                        }}
                    >
                      Cancel
                    </button>

                    <button
                        type="button"
                        onClick={confirmMakeup}
                        disabled={confirming || Number(targetValue) <= 0}
                        style={{
                          width: '100%',
                          minHeight: 46,
                          border: '1px solid #2563eb',
                          borderRadius: 10,
                          padding: '10px 16px',
                          background:
                              confirming || Number(targetValue) <= 0
                                  ? '#93c5fd'
                                  : '#2563eb',
                          color: '#ffffff',
                          fontFamily: 'inherit',
                          fontSize: '0.95rem',
                          fontWeight: 800,
                          lineHeight: 1.2,
                          cursor:
                              confirming || Number(targetValue) <= 0
                                  ? 'not-allowed'
                                  : 'pointer',
                          opacity:
                              confirming || Number(targetValue) <= 0
                                  ? 0.8
                                  : 1,
                          boxSizing: 'border-box',
                        }}
                    >
                      {confirming ? 'Confirming...' : 'Confirm Makeup'}
                    </button>
                  </div>
                </>
            ) : null}
          </div>
        </div>
      </div>
  );
}
