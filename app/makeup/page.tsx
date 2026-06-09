'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import AppHeader from './../components/AppHeader';
import './../styles.css';
import './../dashboard/dashboard.css';

type UserRole = 'superuser' | 'admin' | 'member';
type TrainingType = 'weekend' | 'one_to_one' | 'weekday' | 'matchplay';
type CreditStatus = 'available' | 'used' | 'void';

interface MasterStudent {
    id: string;
    display_name: string;
    normalized_name: string;
    active: boolean;
}

interface MakeupCredit {
    id: string;
    master_student_id: string;
    source_training_type: TrainingType;
    source_date: string;
    source_label: string;
    credit_value: number;
    credit_hours: number | null;
    status: CreditStatus;
    created_at: string;
    master_students?: MasterStudent;
}

interface MakeupUsage {
    id: string;
    target_training_type: TrainingType;
    target_date: string;
    target_label: string;
    target_value: number;
    credit_value_used: number;
    top_up_amount: number;
    payment_status: 'not_required' | 'unpaid' | 'paid';
    master_students?: MasterStudent;
}

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const TRAINING_LABELS: Record<TrainingType, string> = {
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

const normalizeName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
const money = (value: number) => `S$${Number(value || 0).toFixed(2)}`;
const todayKey = () => new Date().toISOString().slice(0, 10);

const getUserRole = (user: any): UserRole => {
    return (user?.app_metadata?.role || user?.user_metadata?.role || 'member') as UserRole;
};

export default function MakeupCreditsPage() {
    const router = useRouter();
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [userName, setUserName] = useState('');

    const [students, setStudents] = useState<MasterStudent[]>([]);
    const [credits, setCredits] = useState<MakeupCredit[]>([]);
    const [usages, setUsages] = useState<MakeupUsage[]>([]);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');

    const [studentName, setStudentName] = useState('');
    const [selectedStudentId, setSelectedStudentId] = useState('');
    const [sourceTrainingType, setSourceTrainingType] = useState<TrainingType>('weekend');
    const [sourceDate, setSourceDate] = useState(todayKey());
    const [sourceLabel, setSourceLabel] = useState('Weekend lesson missed');
    const [creditValue, setCreditValue] = useState(DEFAULT_VALUES.weekend);
    const [creditHours, setCreditHours] = useState<number | ''>('');

    const [selectedCreditId, setSelectedCreditId] = useState('');
    const [targetTrainingType, setTargetTrainingType] = useState<TrainingType>('weekend');
    const [targetDate, setTargetDate] = useState(todayKey());
    const [targetLabel, setTargetLabel] = useState('Weekend makeup lesson');
    const [targetValue, setTargetValue] = useState(DEFAULT_VALUES.weekend);

    const [searchTerm, setSearchTerm] = useState('');
    const [showUsed, setShowUsed] = useState(false);

    useEffect(() => {
        const checkAuth = async () => {
            try {
                const { data: { user }, error } = await supabase.auth.getUser();

                if (error || !user) {
                    await supabase.auth.signOut();
                    router.push('/');
                    return;
                }

                const role = getUserRole(user);
                setUserRole(role);
                setUserName(user.user_metadata?.name || user.email || 'User');
            } catch {
                await supabase.auth.signOut();
                router.push('/');
            }
        };

        checkAuth();
    }, [router]);

    const loadData = async () => {
        try {
            setLoading(true);
            setMessage('');

            const [{ data: studentData, error: studentError }, { data: creditData, error: creditError }, { data: usageData, error: usageError }] = await Promise.all([
                supabase.from('master_students').select('*').eq('active', true).order('display_name', { ascending: true }),
                supabase.from('makeup_credits').select('*, master_students(*)').order('created_at', { ascending: false }),
                supabase.from('makeup_usages').select('*, master_students(*)').order('created_at', { ascending: false }),
            ]);

            if (studentError) throw studentError;
            if (creditError) throw creditError;
            if (usageError) throw usageError;

            setStudents((studentData || []) as MasterStudent[]);
            setCredits((creditData || []) as MakeupCredit[]);
            setUsages((usageData || []) as MakeupUsage[]);
        } catch (err: any) {
            setMessage(err?.message || 'Failed to load makeup data.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (userRole === 'admin' || userRole === 'superuser') {
            loadData();
        }
    }, [userRole]);

    useEffect(() => {
        setCreditValue(DEFAULT_VALUES[sourceTrainingType]);
        setSourceLabel(`${TRAINING_LABELS[sourceTrainingType]} lesson missed`);
    }, [sourceTrainingType]);

    useEffect(() => {
        setTargetValue(DEFAULT_VALUES[targetTrainingType]);
        setTargetLabel(`${TRAINING_LABELS[targetTrainingType]} makeup lesson`);
    }, [targetTrainingType]);

    const availableCredits = useMemo(() => credits.filter((credit) => credit.status === 'available'), [credits]);

    const selectedCredit = useMemo(() => {
        return credits.find((credit) => credit.id === selectedCreditId);
    }, [credits, selectedCreditId]);

    const computedTopUp = useMemo(() => {
        if (!selectedCredit) return 0;
        return Math.max(0, Number(targetValue || 0) - Number(selectedCredit.credit_value || 0));
    }, [selectedCredit, targetValue]);

    const filteredCredits = useMemo(() => {
        const normalizedSearch = searchTerm.trim().toLowerCase();

        return credits.filter((credit) => {
            if (!showUsed && credit.status !== 'available') return false;

            const searchable = [
                credit.master_students?.display_name,
                TRAINING_LABELS[credit.source_training_type],
                credit.source_label,
                credit.source_date,
                money(credit.credit_value),
                credit.status,
            ].join(' ').toLowerCase();

            return !normalizedSearch || searchable.includes(normalizedSearch);
        });
    }, [credits, searchTerm, showUsed]);

    const createOrGetMasterStudent = async () => {
        if (selectedStudentId) return selectedStudentId;

        const name = studentName.trim();
        if (!name) throw new Error('Please select an existing student or enter a new student name.');

        const normalized = normalizeName(name);
        const existing = students.find((student) => student.normalized_name === normalized);
        if (existing) return existing.id;

        const { data, error } = await supabase
            .from('master_students')
            .insert({
                display_name: name,
                normalized_name: normalized,
                active: true,
                updated_at: new Date().toISOString(),
            })
            .select('*')
            .single();

        if (error) throw error;

        const newStudent = data as MasterStudent;
        setStudents((prev) => [...prev, newStudent].sort((a, b) => a.display_name.localeCompare(b.display_name)));
        return newStudent.id;
    };

    const createCredit = async () => {
        try {
            setMessage('');
            const masterStudentId = await createOrGetMasterStudent();
            const value = Number(creditValue);

            if (!value || value <= 0) throw new Error('Credit value must be more than 0.');

            const { error } = await supabase.from('makeup_credits').insert({
                master_student_id: masterStudentId,
                source_training_type: sourceTrainingType,
                source_date: sourceDate,
                source_label: sourceLabel.trim() || `${TRAINING_LABELS[sourceTrainingType]} missed lesson`,
                credit_value: value,
                credit_hours: creditHours === '' ? null : Number(creditHours),
                status: 'available',
                updated_at: new Date().toISOString(),
            });

            if (error) throw error;

            setStudentName('');
            setSelectedStudentId('');
            setMessage('Makeup credit created.');
            await loadData();
        } catch (err: any) {
            setMessage(err?.message || 'Failed to create makeup credit.');
        }
    };

    const useCredit = async () => {
        try {
            setMessage('');

            if (!selectedCredit) throw new Error('Please select a makeup credit to use.');

            const finalTargetValue = Number(targetValue);
            if (!finalTargetValue || finalTargetValue <= 0) throw new Error('Target lesson value must be more than 0.');

            const topUpAmount = Math.max(0, finalTargetValue - Number(selectedCredit.credit_value || 0));
            const paymentStatus = topUpAmount > 0 ? 'unpaid' : 'not_required';

            const { data: usageData, error: usageError } = await supabase
                .from('makeup_usages')
                .insert({
                    makeup_credit_id: selectedCredit.id,
                    master_student_id: selectedCredit.master_student_id,
                    target_training_type: targetTrainingType,
                    target_date: targetDate,
                    target_label: targetLabel.trim() || `${TRAINING_LABELS[targetTrainingType]} makeup lesson`,
                    target_value: finalTargetValue,
                    credit_value_used: Number(selectedCredit.credit_value || 0),
                    top_up_amount: topUpAmount,
                    payment_status: paymentStatus,
                    updated_at: new Date().toISOString(),
                })
                .select('*')
                .single();

            if (usageError) throw usageError;

            const { error: creditError } = await supabase
                .from('makeup_credits')
                .update({
                    status: 'used',
                    used_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq('id', selectedCredit.id);

            if (creditError) throw creditError;

            if (topUpAmount > 0) {
                const paymentMonth = targetDate.slice(0, 7);

                const { error: paymentError } = await supabase
                    .from('makeup_topup_payments')
                    .insert({
                        makeup_usage_id: usageData.id,
                        master_student_id: selectedCredit.master_student_id,
                        amount: topUpAmount,
                        paid: false,
                        payment_month: paymentMonth,
                        updated_at: new Date().toISOString(),
                    });

                if (paymentError) throw paymentError;
            }

            setSelectedCreditId('');
            setMessage(topUpAmount > 0 ? `Makeup recorded. Top-up required: ${money(topUpAmount)}.` : 'Makeup recorded. No top-up required.');
            await loadData();
        } catch (err: any) {
            setMessage(err?.message || 'Failed to use makeup credit.');
        }
    };

    const voidCredit = async (creditId: string) => {
        if (!confirm('Void this makeup credit? Use this only if the credit was created by mistake.')) return;

        try {
            const { error } = await supabase
                .from('makeup_credits')
                .update({ status: 'void', updated_at: new Date().toISOString() })
                .eq('id', creditId);

            if (error) throw error;
            setMessage('Makeup credit voided.');
            await loadData();
        } catch (err: any) {
            setMessage(err?.message || 'Failed to void makeup credit.');
        }
    };

    const handleForbiddenLogout = async () => {
        await supabase.auth.signOut();
        router.push('/');
    };

    if (userRole === null) {
        return (
            <div className="container" style={{ padding: '3rem 1rem' }}>
                <div className="form-card" style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
                    <p className="muted">Checking access...</p>
                </div>
            </div>
        );
    }

    if (userRole !== 'admin' && userRole !== 'superuser') {
        return (
            <div className="container" style={{ padding: '3rem 1rem' }}>
                <div className="form-card" style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
                    <h1 style={{ color: '#dc2626', fontSize: '3rem', marginBottom: '0.5rem' }}>403</h1>
                    <h2 style={{ marginTop: 0 }}>Forbidden</h2>
                    <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>Only admins and superusers can access Makeup Credits.</p>
                    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                        <Link href="/dashboard" className="btn share-btn">Return to Dashboard</Link>
                        <button type="button" className="btn share-btn logout" onClick={handleForbiddenLogout}>Logout</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <AppHeader title="Makeup Credits" userName={userName} userRole={userRole} mode="dashboard" />

            <main style={{ padding: '24px 16px 48px' }}>
                <section className="form-card" style={{ maxWidth: 1180, margin: '0 auto', padding: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                        <div>
                            <h1 style={{ margin: 0 }}>Global Makeup Credits</h1>
                            <p className="muted" style={{ marginTop: 8, maxWidth: 820 }}>
                                Flexible makeup across Weekend, 1-1, Weekday, and MatchPlay. Higher-value makeup needs top-up; lower-value makeup has no refund or discount.
                            </p>
                        </div>
                        <Link href="/makeup/payment" className="btn share-btn">Makeup Payment</Link>
                    </div>

                    {message && (
                        <div className={message.toLowerCase().includes('failed') || message.toLowerCase().includes('error') ? 'error-message' : 'success-message'} style={{ marginTop: 16 }}>
                            {message}
                        </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 20, marginTop: 22 }}>
                        <section style={{ border: '1px solid #e5e7eb', borderRadius: 16, padding: 18, background: '#f8fafc' }}>
                            <h2 style={{ marginTop: 0 }}>1. Create makeup credit</h2>
                            <p className="muted">Create this when a student misses a lesson.</p>

                            <div className="form-group">
                                <label>Existing student</label>
                                <select className="form-input" value={selectedStudentId} onChange={(e) => setSelectedStudentId(e.target.value)}>
                                    <option value="">Choose existing student or type new below</option>
                                    {students.map((student) => (
                                        <option key={student.id} value={student.id}>{student.display_name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group">
                                <label>New student name</label>
                                <input className="form-input" value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="e.g. Brendan Lau" disabled={Boolean(selectedStudentId)} />
                                <p className="muted" style={{ fontSize: '0.82rem', marginTop: 5 }}>
                                    Names are normalized, so repeated names are easier to catch.
                                </p>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                                <div className="form-group">
                                    <label>Missed from</label>
                                    <select className="form-input" value={sourceTrainingType} onChange={(e) => setSourceTrainingType(e.target.value as TrainingType)}>
                                        {Object.entries(TRAINING_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Missed date</label>
                                    <input className="form-input" type="date" value={sourceDate} onChange={(e) => setSourceDate(e.target.value)} />
                                </div>
                            </div>

                            <div className="form-group">
                                <label>Credit label</label>
                                <input className="form-input" value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} />
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                                <div className="form-group">
                                    <label>Credit value (S$)</label>
                                    <input className="form-input" type="number" min="0" step="0.01" value={creditValue} onChange={(e) => setCreditValue(Number(e.target.value))} />
                                </div>
                                <div className="form-group">
                                    <label>Credit hours (optional)</label>
                                    <input className="form-input" type="number" min="0" step="0.25" value={creditHours} onChange={(e) => setCreditHours(e.target.value === '' ? '' : Number(e.target.value))} />
                                </div>
                            </div>

                            <button type="button" className="login-btn" onClick={createCredit} disabled={loading}>Create Credit</button>
                        </section>

                        <section style={{ border: '1px solid #e5e7eb', borderRadius: 16, padding: 18, background: '#f8fafc' }}>
                            <h2 style={{ marginTop: 0 }}>2. Use makeup credit</h2>
                            <p className="muted">Choose a makeup target. Top-up is calculated automatically.</p>

                            <div className="form-group">
                                <label>Available credit</label>
                                <select className="form-input" value={selectedCreditId} onChange={(e) => setSelectedCreditId(e.target.value)}>
                                    <option value="">Choose makeup credit</option>
                                    {availableCredits.map((credit) => (
                                        <option key={credit.id} value={credit.id}>
                                            {credit.master_students?.display_name || 'Unknown'} · {TRAINING_LABELS[credit.source_training_type]} · {money(credit.credit_value)}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                                <div className="form-group">
                                    <label>Makeup into</label>
                                    <select className="form-input" value={targetTrainingType} onChange={(e) => setTargetTrainingType(e.target.value as TrainingType)}>
                                        {Object.entries(TRAINING_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Makeup date</label>
                                    <input className="form-input" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
                                </div>
                            </div>

                            <div className="form-group">
                                <label>Target label</label>
                                <input className="form-input" value={targetLabel} onChange={(e) => setTargetLabel(e.target.value)} />
                            </div>

                            <div className="form-group">
                                <label>Target value (S$)</label>
                                <input className="form-input" type="number" min="0" step="0.01" value={targetValue} onChange={(e) => setTargetValue(Number(e.target.value))} />
                            </div>

                            <div style={{ border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 14, padding: 14, marginBottom: 14 }}>
                                <div style={{ display: 'grid', gap: 6 }}>
                                    <div>Credit value: <strong>{selectedCredit ? money(selectedCredit.credit_value) : '-'}</strong></div>
                                    <div>Target value: <strong>{money(targetValue)}</strong></div>
                                    <div>Top-up required: <strong style={{ color: computedTopUp > 0 ? '#dc2626' : '#047857' }}>{money(computedTopUp)}</strong></div>
                                    <div className="muted" style={{ fontSize: '0.84rem' }}>Formula: max(0, target value - credit value). Lower-value makeup has no refund.</div>
                                </div>
                            </div>

                            <button type="button" className="login-btn" onClick={useCredit} disabled={loading || !selectedCredit}>Confirm Makeup</button>
                        </section>
                    </div>

                    <section style={{ marginTop: 24 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                            <h2 style={{ margin: 0 }}>Makeup Credit Ledger</h2>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                                <input className="filter-input" placeholder="Search student, source, label..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ minWidth: 240 }} />
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                                    <input type="checkbox" checked={showUsed} onChange={(e) => setShowUsed(e.target.checked)} />
                                    Show used/void
                                </label>
                                <button type="button" className="btn share-btn" onClick={loadData} disabled={loading}>Refresh</button>
                            </div>
                        </div>

                        <div className="table-container" style={{ marginTop: 14 }}>
                            <div className="table-scroll">
                                <table>
                                    <thead>
                                    <tr>
                                        <th>Student</th>
                                        <th>Missed From</th>
                                        <th>Missed Date</th>
                                        <th>Credit</th>
                                        <th>Status</th>
                                        <th>Actions</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {filteredCredits.length === 0 ? (
                                        <tr><td colSpan={6} style={{ textAlign: 'center', color: '#64748b' }}>No makeup credits found.</td></tr>
                                    ) : (
                                        filteredCredits.map((credit) => (
                                            <tr key={credit.id}>
                                                <td>{credit.master_students?.display_name || 'Unknown student'}</td>
                                                <td><strong>{TRAINING_LABELS[credit.source_training_type]}</strong><br /><span className="muted">{credit.source_label}</span></td>
                                                <td>{credit.source_date}</td>
                                                <td><strong>{money(credit.credit_value)}</strong>{credit.credit_hours ? <div className="muted">{credit.credit_hours}h</div> : null}</td>
                                                <td>{credit.status}</td>
                                                <td>{credit.status === 'available' ? <button type="button" className="delete-btn" onClick={() => voidCredit(credit.id)}>Void</button> : '-'}</td>
                                            </tr>
                                        ))
                                    )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </section>

                    <section style={{ marginTop: 24 }}>
                        <h2>Recent Makeup Usage</h2>
                        <div className="table-container">
                            <div className="table-scroll">
                                <table>
                                    <thead>
                                    <tr>
                                        <th>Student</th>
                                        <th>Used For</th>
                                        <th>Target Value</th>
                                        <th>Credit Used</th>
                                        <th>Top-up</th>
                                        <th>Payment</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {usages.length === 0 ? (
                                        <tr><td colSpan={6} style={{ textAlign: 'center', color: '#64748b' }}>No makeup usage yet.</td></tr>
                                    ) : (
                                        usages.slice(0, 12).map((usage) => (
                                            <tr key={usage.id}>
                                                <td>{usage.master_students?.display_name || 'Unknown student'}</td>
                                                <td><strong>{TRAINING_LABELS[usage.target_training_type]}</strong><br /><span className="muted">{usage.target_date} · {usage.target_label}</span></td>
                                                <td>{money(usage.target_value)}</td>
                                                <td>{money(usage.credit_value_used)}</td>
                                                <td><strong style={{ color: Number(usage.top_up_amount || 0) > 0 ? '#dc2626' : '#047857' }}>{money(usage.top_up_amount)}</strong></td>
                                                <td>{usage.payment_status}</td>
                                            </tr>
                                        ))
                                    )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </section>
                </section>
            </main>
        </div>
    );
}
