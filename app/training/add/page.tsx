'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import AppHeader from './../../components/AppHeader';
import './../../styles.css';
import './../../dashboard/dashboard.css';
import './../../add/add.css';

type UserRole = 'superuser' | 'admin' | 'member';

interface OneToOneStudent {
    id: string;
    student_name: string;
    payment_amount: number;
    active: boolean;
    created_at?: string;
    updated_at?: string;
}

const DEFAULT_PAYMENT_AMOUNT = 80;

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const getUserRole = (user: any): UserRole => {
    return (user?.app_metadata?.role || user?.user_metadata?.role || 'member') as UserRole;
};

export default function AddOneToOneStudentPage() {
    const router = useRouter();
    const [userName, setUserName] = useState('');
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [studentName, setStudentName] = useState('');
    const [paymentAmount, setPaymentAmount] = useState<number | ''>(DEFAULT_PAYMENT_AMOUNT);
    const [students, setStudents] = useState<OneToOneStudent[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoadingStudents, setIsLoadingStudents] = useState(false);

    useEffect(() => {
        const checkAuth = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push('/');
                return;
            }

            const role = getUserRole(user);
            setUserRole(role);
            setUserName(user.user_metadata?.name || user.email || 'User');
        };

        checkAuth();
    }, [router]);

    const loadStudents = async () => {
        try {
            setIsLoadingStudents(true);

            const { data, error: loadError } = await supabase
                .from('one_to_one_students')
                .select('id, student_name, payment_amount, active, created_at, updated_at')
                .eq('active', true)
                .order('student_name', { ascending: true });

            if (loadError) throw loadError;

            setStudents((data || []) as OneToOneStudent[]);
        } catch (err: any) {
            setError(err?.message || 'Failed to load existing 1-1 students.');
        } finally {
            setIsLoadingStudents(false);
        }
    };

    useEffect(() => {
        if (userRole) loadStudents();
    }, [userRole]);

    const filteredStudents = useMemo(() => {
        const normalized = searchTerm.trim().toLowerCase();

        if (!normalized) return students;

        return students.filter((student) =>
            [
                student.student_name,
                `S$${Number(student.payment_amount || 0).toFixed(2)}`,
            ].join(' ').toLowerCase().includes(normalized)
        );
    }, [students, searchTerm]);

    const updateStudentAmount = async (studentId: string, amount: number) => {
        const safeAmount = Number(amount) || 0;

        if (safeAmount <= 0) {
            alert('Payment amount must be more than 0.');
            return;
        }

        try {
            const { data, error: updateError } = await supabase
                .from('one_to_one_students')
                .update({
                    payment_amount: safeAmount,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', studentId)
                .select('id, student_name, payment_amount, active, created_at, updated_at')
                .single();

            if (updateError) throw updateError;

            const updatedStudent = data as OneToOneStudent;
            setStudents((prev) =>
                prev.map((student) =>
                    student.id === studentId ? updatedStudent : student
                )
            );

            setSuccess(`Updated ${updatedStudent.student_name}'s payment amount.`);
        } catch (err: any) {
            alert(err?.message || 'Failed to update payment amount.');
            await loadStudents();
        }
    };

    const removeStudent = async (studentId: string, studentName: string) => {
        if (!confirm(`Remove ${studentName} from 1-1 students? Existing session history will remain, but they will no longer appear in dropdowns.`)) {
            return;
        }

        try {
            const { error: updateError } = await supabase
                .from('one_to_one_students')
                .update({
                    active: false,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', studentId);

            if (updateError) throw updateError;

            setStudents((prev) => prev.filter((student) => student.id !== studentId));
            setSuccess(`${studentName} removed from active 1-1 students.`);
        } catch (err: any) {
            alert(err?.message || 'Failed to remove 1-1 student.');
            await loadStudents();
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        if (!studentName.trim()) {
            setError('Student name is required.');
            return;
        }

        const amount = Number(paymentAmount);
        if (!amount || amount <= 0) {
            setError('Payment amount must be more than 0.');
            return;
        }

        try {
            setIsSubmitting(true);

            const { data, error: insertError } = await supabase
                .from('one_to_one_students')
                .insert({
                    student_name: studentName.trim(),
                    payment_amount: amount,
                    active: true,
                    updated_at: new Date().toISOString()
                })
                .select('id, student_name, payment_amount, active, created_at, updated_at')
                .single();

            if (insertError) throw insertError;

            setStudents((prev) => [...prev, data as OneToOneStudent].sort((a, b) => a.student_name.localeCompare(b.student_name)));
            setStudentName('');
            setPaymentAmount(DEFAULT_PAYMENT_AMOUNT);
            setSuccess('1-1 student added successfully.');
        } catch (err: any) {
            setError(err?.message || 'Failed to add 1-1 student.');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (userRole === 'member') {
        return (
            <div className="container" style={{ padding: '3rem 1rem' }}>
                <div className="form-card" style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
                    <h1 style={{ color: '#dc2626' }}>403</h1>
                    <p>Only superusers and admins can add 1-1 students.</p>
                    <Link href="/dashboard" className="btn share-btn">Go to Dashboard</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <AppHeader title="Add 1-1 Student" userName={userName} userRole={userRole} mode="dashboard" />

            <main>
                <div className="form-card" style={{ maxWidth: 860, margin: '0 auto' }}>
                    <h2>Add 1-1 Student</h2>
                    <p className="muted">
                        These students are separate from weekend students and appear in the 1-1 Training dropdown.
                    </p>

                    {error && <div className="error-message">{error}</div>}
                    {success && <div className="success-message">{success}</div>}

                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label htmlFor="studentName">Name</label>
                            <input
                                id="studentName"
                                className="form-input"
                                value={studentName}
                                onChange={(e) => setStudentName(e.target.value)}
                                placeholder="Student name"
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="paymentAmount">Payment Amount (S$)</label>
                            <input
                                id="paymentAmount"
                                className="form-input"
                                type="number"
                                min="0"
                                step="0.01"
                                value={paymentAmount}
                                onChange={(e) => setPaymentAmount(e.target.value === '' ? '' : Number(e.target.value))}
                                placeholder="80"
                            />
                        </div>

                        <button className="login-btn" type="submit" disabled={isSubmitting}>
                            {isSubmitting ? 'Adding...' : 'Add 1-1 Student'}
                        </button>
                    </form>
                </div>

                <div className="form-card" style={{ maxWidth: 960, margin: '24px auto 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <div>
                            <h2 style={{ marginTop: 0 }}>Existing 1-1 Students</h2>
                            <p className="muted" style={{ marginTop: -6 }}>
                                Use this list to check who has already been registered. You can also edit each student's payment amount here.
                            </p>
                        </div>

                        <button type="button" className="btn share-btn" onClick={loadStudents} disabled={isLoadingStudents}>
                            {isLoadingStudents ? 'Refreshing...' : 'Refresh'}
                        </button>
                    </div>

                    <div className="search-box" style={{ marginTop: 16 }}>
                        <input
                            type="text"
                            placeholder="Search existing 1-1 students..."
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                        />
                    </div>

                    {isLoadingStudents ? (
                        <p className="muted">Loading existing 1-1 students...</p>
                    ) : filteredStudents.length === 0 ? (
                        <p className="muted">No active 1-1 students found.</p>
                    ) : (
                        <div className="table-container">
                            <div className="table-scroll">
                                <table>
                                    <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Payment Amount</th>
                                        <th>Added</th>
                                        <th>Actions</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {filteredStudents.map((student) => (
                                        <tr key={student.id}>
                                            <td>{student.student_name}</td>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <span>S$</span>
                                                    <input
                                                        className="weeks-input"
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        value={Number(student.payment_amount || 0)}
                                                        onChange={(event) =>
                                                            updateStudentAmount(student.id, Number(event.target.value))
                                                        }
                                                    />
                                                </div>
                                            </td>
                                            <td>
                                                {student.created_at
                                                    ? new Date(student.created_at).toLocaleDateString()
                                                    : '-'}
                                            </td>
                                            <td>
                                                <button
                                                    type="button"
                                                    className="delete-btn"
                                                    onClick={() => removeStudent(student.id, student.student_name)}
                                                >
                                                    Remove
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
