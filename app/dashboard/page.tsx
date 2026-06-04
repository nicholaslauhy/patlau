"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import AppHeader from "./../components/AppHeader";
import "./../styles.css";
import "./dashboard.css";
import { Student } from "../../types/supabase";

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export default function DashboardPage() {
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<Student[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDay, setSelectedDay] = useState("all");
  const [selectedTimeslot, setSelectedTimeslot] = useState("all");
  const [selectedLevel, setSelectedLevel] = useState("all");
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userRole, setUserRole] = useState<
      "superuser" | "admin" | "member" | null
  >(null);

  const days = ["all", "Saturday", "Sunday"];
  const timeslots = [
    "all",
    "8-10am",
    "10-12pm",
    "1-3pm",
    "2-4pm",
    "3-5pm",
    "4-6pm",
  ];
  const levels = ["all", "Beginner", "Intermediate", "Advanced"];

  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const displayName =
            user.user_metadata?.name || user.email?.split("@")[0] || "User";
        setUserName(displayName);
        setUserEmail(user.email || "");
      } catch (err) {
        console.error("Failed to load user profile:", err);
      }
    };

    loadUserProfile();
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          router.push("/");
          return;
        }
        const role =
            (user.user_metadata?.role as "superuser" | "admin" | "member") ||
            "member";
        setUserRole(role);
      } catch (err) {
        router.push("/");
      }
    };
    checkAuth();
  }, [router]);

  const logAuditAction = async (
      studentId: string,
      action: "mark" | "makeup" | "undo" | "delete" | "reset" | "missed",
  ) => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      await fetch("/api/audit/log-attendance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ student_id: studentId, action }),
      });
    } catch (err) {
      console.error("Failed to log audit:", err);
    }
  };

  const normalizeName = (value: string) =>
      value.trim().toLowerCase().replace(/\s+/g, " ");

  const getVisibleStudents = (students: Student[]) => {
    if (userRole !== "member") {
      return students;
    }

    const possibleMemberNames = [userName, userEmail, userEmail.split("@")[0]]
        .map((value) => normalizeName(value || ""))
        .filter(Boolean);

    if (possibleMemberNames.length === 0) {
      return [];
    }

    return students.filter((student) => {
      const studentName = normalizeName(student.student_name || "");
      return possibleMemberNames.some(
          (memberName) =>
              studentName === memberName ||
              studentName.includes(memberName) ||
              memberName.includes(studentName),
      );
    });
  };

  const fetchData = async () => {
    setIsLoading(true);
    setMessage(null);
    try {
      let query = supabase.from("students").select("*");
      if (selectedDay !== "all") query = query.eq("student_day", selectedDay);
      if (selectedTimeslot !== "all")
        query = query.eq("student_timeslot", selectedTimeslot);
      if (selectedLevel !== "all")
        query = query.eq("student_levelofplay", selectedLevel);
      const { data, error } = await query;
      if (error) {
        setSearchResults([]);
        setMessage("Failed to load student records.");
        return;
      }
      const visibleData = getVisibleStudents(Array.isArray(data) ? data : []);

      if (visibleData.length > 0) {
        setSearchResults(visibleData);
      } else {
        setSearchResults([]);
        setMessage("No student records found.");
      }
    } catch {
      setSearchResults([]);
      setMessage("Failed to load student records.");
    } finally {
      setIsLoading(false);
    }
  };

  // Delete student (server route)
  const deleteStudent = async (studentId: string, studentName?: string) => {
    if (
        !confirm(
            `Delete ${studentName ?? "this student"}? This cannot be undone.`,
        )
    )
      return;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");
      const response = await fetch("/api/students/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ student_id: studentId }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Delete failed");
      }
      await logAuditAction(studentId, "delete");
      fetchData();
    } catch (err: any) {
      alert(`Delete failed: ${err?.message ?? "Unknown error"}`);
    }
  };

  // Replace existing handleDeleteLastAttendance with this
  const handleDeleteLastAttendance = async (studentId: string) => {
    try {
      // get current user (for logging)
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // load the current student row
      const { data: studentData, error: fetchError } = await supabase
          .from("students")
          .select("*")
          .eq("student_id", studentId)
          .single();
      if (fetchError || !studentData)
        throw fetchError || new Error("Student not found");

      // fetch the latest audit action for this student (mark/makeup/missed)
      const { data: auditLogs, error: auditError } = await supabase
          .from("student_audit")
          .select("*")
          .eq("student_id", studentId)
          .in("action", ["mark", "makeup", "missed"])
          .order("created_at", { ascending: false })
          .limit(1);

      if (auditError) throw auditError;

      let lastAction =
          Array.isArray(auditLogs) && auditLogs.length > 0 ? auditLogs[0] : null;

      // If there is no audit row, offer a best-effort undo based on counters
      if (!lastAction) {
        const ok = confirm(
            "No audit action found. Attempt best-effort undo based on current counters? Click OK to proceed or Cancel to abort.",
        );
        if (!ok) return;

        let newAttended = studentData.attended ?? 0;
        let newMissed = studentData.missed ?? 0;
        let newRecords = Array.isArray(studentData.attendance_records)
            ? [...studentData.attendance_records]
            : [];

        if (newAttended > 0) {
          newAttended = Math.max(0, newAttended - 1);
          if (newRecords.length > 0) newRecords.pop();
        } else if (newMissed > 0) {
          newMissed = Math.max(0, newMissed - 1);
        } else {
          alert("Nothing to undo.");
          return;
        }

        const { data: updatedStudent, error } = await supabase
            .from("students")
            .update({
              attended: newAttended,
              missed: newMissed,
              attendance_records: newRecords,
              updated_at: new Date().toISOString(),
            })
            .eq("student_id", studentId)
            .select()
            .single();

        if (error || !updatedStudent) throw error || new Error("Update failed");

        // Log undo and refresh UI
        await logAuditAction(studentId, "undo");
        await fetchData();
        return;
      }

      // Reverse the last action (mark/makeup/missed)
      let newAttended = studentData.attended ?? 0;
      let newMissed = studentData.missed ?? 0;
      let newRecords = Array.isArray(studentData.attendance_records)
          ? [...studentData.attendance_records]
          : [];

      if (lastAction.action === "mark") {
        newAttended = Math.max(0, newAttended - 1);
        if (newRecords.length > 0) newRecords.pop();
      } else if (lastAction.action === "missed") {
        newMissed = Math.max(0, newMissed - 1);
      } else if (lastAction.action === "makeup") {
        // makeup did missed--, attended++; undo does attended--, missed++
        newAttended = Math.max(0, newAttended - 1);
        newMissed = newMissed + 1;
        if (newRecords.length > 0) newRecords.pop();
      } else {
        alert("Last action cannot be undone.");
        return;
      }

      // Apply update to students table
      const { data: updatedStudent, error } = await supabase
          .from("students")
          .update({
            attended: newAttended,
            missed: newMissed,
            attendance_records: newRecords,
            updated_at: new Date().toISOString(),
          })
          .eq("student_id", studentId)
          .select()
          .single();

      if (error || !updatedStudent) throw error || new Error("Update failed");

      // Log undo in audit table (so history is preserved)
      await logAuditAction(studentId, "undo");

      // refresh UI
      await fetchData();
    } catch (err: any) {
      alert(`Failed to undo attendance: ${err?.message ?? "Unknown error"}`);
    }
  };

  // Mark attended (only on student's scheduled day)
  const handleAttendanceClick = async (studentId: string) => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: studentData, error: fetchError } = await supabase
          .from("students")
          .select("*")
          .eq("student_id", studentId)
          .single();
      if (fetchError || !studentData)
        throw fetchError || new Error("Student not found");

      const today = new Date().getDay();
      const isStudentDay =
          (today === 6 && studentData.student_day === "Saturday") ||
          (today === 0 && studentData.student_day === "Sunday");

      if (!isStudentDay) {
        alert(`Can only mark attendance on ${studentData.student_day}`);
        return;
      }

      const attended = studentData.attended ?? 0;
      const missed = studentData.missed ?? 0;
      const totalWeeks = studentData.total_weeks ?? 0;
      if (attended + missed >= totalWeeks) {
        alert("Total lessons for this subscription have already been used.");
        return;
      }

      const newAttended = attended + 1;
      const newRecords = Array.isArray(studentData.attendance_records)
          ? [...studentData.attendance_records, new Date().toISOString()]
          : [new Date().toISOString()];

      const { data: updatedStudent, error } = await supabase
          .from("students")
          .update({
            attended: newAttended,
            attendance_records: newRecords,
            updated_at: new Date().toISOString(),
          })
          .eq("student_id", studentId)
          .select()
          .single();

      if (error || !updatedStudent) throw error || new Error("Update failed");

      setSearchResults((prev) =>
          prev.map((s) => (s.student_id === studentId ? updatedStudent : s)),
      );
      await logAuditAction(studentId, "mark");
    } catch (err: any) {
      alert(`Failed to record attendance: ${err?.message ?? "Unknown error"}`);
    }
  };

  // Makeup: convert one missed to attended
  const handleMakeupAttendance = async (studentId: string) => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: studentData, error: fetchError } = await supabase
          .from("students")
          .select("*")
          .eq("student_id", studentId)
          .single();
      if (fetchError || !studentData)
        throw fetchError || new Error("Student not found");

      const attended = studentData.attended ?? 0;
      const missed = studentData.missed ?? 0;
      const totalWeeks = studentData.total_weeks ?? 0;

      if (missed <= 0) {
        alert("No missed lessons available to convert to makeup.");
        return;
      }

      if (attended + missed > totalWeeks) {
        alert("Cannot makeup because subscription total would be exceeded.");
        return;
      }

      const newAttended = attended + 1;
      const newMissed = Math.max(0, missed - 1);
      const newRecords = Array.isArray(studentData.attendance_records)
          ? [...studentData.attendance_records, new Date().toISOString()]
          : [new Date().toISOString()];

      const { data: updatedStudent, error } = await supabase
          .from("students")
          .update({
            attended: newAttended,
            missed: newMissed,
            attendance_records: newRecords,
            updated_at: new Date().toISOString(),
          })
          .eq("student_id", studentId)
          .select()
          .single();

      if (error || !updatedStudent) throw error || new Error("Update failed");

      setSearchResults((prev) =>
          prev.map((s) => (s.student_id === studentId ? updatedStudent : s)),
      );
      await logAuditAction(studentId, "makeup");
    } catch (err: any) {
      alert(
          `Failed to record makeup attendance: ${err?.message ?? "Unknown error"}`,
      );
    }
  };

  // Missed: mark a lesson as missed (no attendance record appended)
  const handleMissed = async (studentId: string) => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: studentData, error: fetchError } = await supabase
          .from("students")
          .select("*")
          .eq("student_id", studentId)
          .single();
      if (fetchError || !studentData)
        throw fetchError || new Error("Student not found");

      const attended = studentData.attended ?? 0;
      const missed = studentData.missed ?? 0;
      const totalWeeks = studentData.total_weeks ?? 0;

      if (attended + missed >= totalWeeks) {
        alert("Total lessons for this subscription have already been used.");
        return;
      }

      const newMissed = missed + 1;

      const { data: updatedStudent, error } = await supabase
          .from("students")
          .update({
            missed: newMissed,
            updated_at: new Date().toISOString(),
          })
          .eq("student_id", studentId)
          .select()
          .single();

      if (error || !updatedStudent) throw error || new Error("Update failed");

      setSearchResults((prev) =>
          prev.map((s) => (s.student_id === studentId ? updatedStudent : s)),
      );

      // AWAIT this so the audit log is written before function returns
      await logAuditAction(studentId, "missed");
    } catch (err: any) {
      alert(`Failed to mark missed: ${err?.message ?? "Unknown error"}`);
    }
  };

  // Reset: clears attended/missed (only allowed if paid === true)
  const handleResetCourse = async (studentId: string) => {
    if (
        !confirm("Reset this course? This will clear attended and missed counts.")
    )
      return;
    try {
      const student = searchResults.find((s) => s.student_id === studentId);
      if (!student) throw new Error("Student not found");

      const paid = Boolean(student.paid ?? false);
      if (!paid) {
        const override = confirm(
            "Student must have paid for a new subscription before reset.\n\nClick OK to force reset anyway, or Cancel to abort.",
        );
        if (!override) {
          alert("Reset cancelled.");
          return;
        }
      }

      const { data: updatedStudent, error } = await supabase
          .from("students")
          .update({
            attended: 0,
            missed: 0,
            attendance_records: [],
            paid: false,
            updated_at: new Date().toISOString(),
          })
          .eq("student_id", studentId)
          .select()
          .single();

      if (error || !updatedStudent) throw error || new Error("Reset failed");

      setSearchResults((prev) =>
          prev.map((s) => (s.student_id === studentId ? updatedStudent : s)),
      );
      await logAuditAction(studentId, "reset");
      alert("Course reset successfully!");
    } catch (err: any) {
      alert(`Failed to reset course: ${err?.message ?? "Unknown error"}`);
    }
  };

  useEffect(() => {
    const handler = setTimeout(async () => {
      const term = searchTerm.trim();
      if (term.length === 0) {
        fetchData();
        return;
      }
      try {
        const response = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ searchTerm: term }),
        });
        if (!response.ok) {
          setSearchResults([]);
          setMessage("Search failed.");
          return;
        }
        const data = await response.json();
        setSearchResults(getVisibleStudents(data.results || []));
      } catch {
        setSearchResults([]);
        setMessage("Search failed.");
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [searchTerm, userRole, userName, userEmail]);

  useEffect(() => {
    if (userRole !== null) {
      fetchData();
    }
  }, [
    selectedDay,
    selectedTimeslot,
    selectedLevel,
    userRole,
    userName,
    userEmail,
  ]);

  const canEditStudentFields = userRole === "superuser";
  const isSuperuser = userRole === "superuser";

  return (
      <div className="container">
        <AppHeader
            title="Dashboard"
            userName={userName}
            userRole={userRole}
            mode="dashboard"
        />

        <main>
          <div className="search-box">
            <input
                aria-label="Search students"
                type="text"
                placeholder="Search students"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="filter-box">
            <div className="filter-grid">
              <div className="filter-group">
                <label className="filter-label">
                  Day
                  <select
                      value={selectedDay}
                      onChange={(e) => setSelectedDay(e.target.value)}
                      className="filter-input"
                  >
                    {days.map((d) => (
                        <option key={d} value={d}>
                          {d === "all" ? "All Days" : d}
                        </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="filter-group">
                <label className="filter-label">
                  Timeslot
                  <select
                      value={selectedTimeslot}
                      onChange={(e) => setSelectedTimeslot(e.target.value)}
                      className="filter-input"
                  >
                    {timeslots.map((t) => (
                        <option key={t} value={t}>
                          {t === "all" ? "All Timeslots" : t}
                        </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="filter-group">
                <label className="filter-label">
                  Level
                  <select
                      value={selectedLevel}
                      onChange={(e) => setSelectedLevel(e.target.value)}
                      className="filter-input"
                  >
                    {levels.map((l) => (
                        <option key={l} value={l}>
                          {l === "all" ? "All Levels" : l}
                        </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="filter-buttons">
              <button
                  onClick={() => {
                    setSelectedDay("all");
                    setSelectedTimeslot("all");
                    setSelectedLevel("all");
                    setSearchTerm("");
                    fetchData();
                  }}
                  className="filter-button secondary"
              >
                Reset
              </button>
              <button onClick={() => fetchData()} className="filter-button">
                Apply
              </button>
            </div>
          </div>

          <div className="search-results-display">
            {isLoading && <p className="muted">Loading…</p>}
            {!isLoading && message && <p className="muted">{message}</p>}

            {!isLoading &&
                Array.isArray(searchResults) &&
                searchResults.length > 0 && (
                    <div className="table-container">
                      <div className="table-scroll">
                        <table>
                          <thead>
                          <tr>
                            <th>Name</th>
                            <th>Day</th>
                            <th>Timeslot</th>
                            <th>Level</th>
                            <th>Attended</th>
                            <th>Missed</th>
                            <th
                                style={{
                                  width: userRole === "superuser" ? 420 : 280,
                                }}
                            >
                              Actions
                            </th>
                          </tr>
                          </thead>
                          <tbody>
                          {searchResults.map((student) => {
                            const attended = student.attended ?? 0;
                            const missed = student.missed ?? 0;
                            const lessonsUsed = attended + missed;
                            const finished =
                                lessonsUsed >= (student.total_weeks ?? 0);

                            return (
                                <tr key={student.student_id}>
                                  <td>{student.student_name}</td>
                                  <td>
                                    {canEditStudentFields ? (
                                        <select
                                            className="student-field-select"
                                            aria-label="Change day"
                                            value={student.student_day}
                                            onChange={async (e) => {
                                              const newDay = e.target.value;
                                              try {
                                                const { error } = await supabase
                                                    .from("students")
                                                    .update({
                                                      student_day: newDay,
                                                      updated_at: new Date().toISOString(),
                                                    })
                                                    .eq("student_id", student.student_id);
                                                if (error) throw error;
                                                setSearchResults((prev) =>
                                                    prev.map((s) =>
                                                        s.student_id === student.student_id
                                                            ? {
                                                              ...s,
                                                              student_day: newDay,
                                                              updated_at:
                                                                  new Date().toISOString(),
                                                            }
                                                            : s,
                                                    ),
                                                );
                                              } catch (err: any) {
                                                alert(
                                                    `Failed to update day: ${err?.message ?? "Unknown error"}`,
                                                );
                                              }
                                            }}
                                        >
                                          <option value="Saturday">Saturday</option>
                                          <option value="Sunday">Sunday</option>
                                        </select>
                                    ) : (
                                        <span
                                            title="Only superusers can change this"
                                            style={{
                                              cursor: "not-allowed",
                                              opacity: 0.7,
                                            }}
                                        >
                                  {student.student_day}
                                </span>
                                    )}
                                  </td>

                                  <td>
                                    {canEditStudentFields ? (
                                        <select
                                            className="student-field-select"
                                            aria-label="Change timeslot"
                                            value={student.student_timeslot}
                                            onChange={async (e) => {
                                              const newTimeslot = e.target.value;
                                              try {
                                                const { error } = await supabase
                                                    .from("students")
                                                    .update({
                                                      student_timeslot: newTimeslot,
                                                      updated_at: new Date().toISOString(),
                                                    })
                                                    .eq("student_id", student.student_id);
                                                if (error) throw error;
                                                setSearchResults((prev) =>
                                                    prev.map((s) =>
                                                        s.student_id === student.student_id
                                                            ? {
                                                              ...s,
                                                              student_timeslot: newTimeslot,
                                                              updated_at:
                                                                  new Date().toISOString(),
                                                            }
                                                            : s,
                                                    ),
                                                );
                                              } catch (err: any) {
                                                alert(
                                                    `Failed to update timeslot: ${err?.message ?? "Unknown error"}`,
                                                );
                                              }
                                            }}
                                        >
                                          <option value="8-10am">8-10am</option>
                                          <option value="10-12pm">10-12pm</option>
                                          <option value="1-3pm">1-3pm</option>
                                          <option value="2-4pm">2-4pm</option>
                                          <option value="3-5pm">3-5pm</option>
                                          <option value="4-6pm">4-6pm</option>
                                        </select>
                                    ) : (
                                        <span
                                            title="Only superusers can change this"
                                            style={{
                                              cursor: "not-allowed",
                                              opacity: 0.7,
                                            }}
                                        >
                                  {student.student_timeslot}
                                </span>
                                    )}
                                  </td>

                                  <td>
                                    {canEditStudentFields ? (
                                        <select
                                            className="student-field-select"
                                            aria-label="Change level"
                                            value={student.student_levelofplay}
                                            onChange={async (e) => {
                                              const newLevel = e.target.value;
                                              try {
                                                const { error } = await supabase
                                                    .from("students")
                                                    .update({
                                                      student_levelofplay: newLevel,
                                                      updated_at: new Date().toISOString(),
                                                    })
                                                    .eq("student_id", student.student_id);
                                                if (error) throw error;
                                                setSearchResults((prev) =>
                                                    prev.map((s) =>
                                                        s.student_id === student.student_id
                                                            ? {
                                                              ...s,
                                                              student_levelofplay: newLevel,
                                                              updated_at:
                                                                  new Date().toISOString(),
                                                            }
                                                            : s,
                                                    ),
                                                );
                                              } catch (err: any) {
                                                alert(
                                                    `Failed to update level: ${err?.message ?? "Unknown error"}`,
                                                );
                                              }
                                            }}
                                        >
                                          <option value="Beginner">Beginner</option>
                                          <option value="Intermediate">
                                            Intermediate
                                          </option>
                                          <option value="Advanced">Advanced</option>
                                        </select>
                                    ) : (
                                        <span
                                            title="Only superusers can change this"
                                            style={{
                                              cursor: "not-allowed",
                                              opacity: 0.7,
                                            }}
                                        >
                                  {student.student_levelofplay}
                                </span>
                                    )}
                                  </td>

                                  <td
                                      className="lessons-count"
                                      title={`${attended} attended`}
                                  >
                                    {attended}
                                  </td>
                                  <td
                                      className="missed-count"
                                      title={`${missed} missed`}
                                  >
                                    {missed}
                                  </td>

                                  <td className="actions-cell">
                                    <div className="actions-row">
                                      <button
                                          type="button"
                                          className="attendance-btn"
                                          onClick={() =>
                                              handleAttendanceClick(student.student_id)
                                          }
                                          disabled={finished}
                                          title={
                                            finished
                                                ? "Subscription lessons completed"
                                                : "Mark attended"
                                          }
                                      >
                                        Mark
                                      </button>

                                      <button
                                          type="button"
                                          className="missed-btn"
                                          onClick={() =>
                                              handleMissed(student.student_id)
                                          }
                                          disabled={finished}
                                          title={
                                            finished
                                                ? "Subscription lessons completed"
                                                : "Mark missed"
                                          }
                                      >
                                        Missed
                                      </button>

                                      <button
                                          type="button"
                                          className="makeup-btn"
                                          onClick={() =>
                                              handleMakeupAttendance(student.student_id)
                                          }
                                          disabled={
                                              finished || (student.missed ?? 0) <= 0
                                          }
                                          title={
                                            (student.missed ?? 0) <= 0
                                                ? "No missed lessons to makeup"
                                                : "Makeup (convert one missed to attended)"
                                          }
                                      >
                                        Makeup
                                      </button>

                                      <button
                                          type="button"
                                          className="undo-btn"
                                          onClick={() =>
                                              handleDeleteLastAttendance(
                                                  student.student_id,
                                              )
                                          }
                                          disabled={
                                              (student.attended ?? 0) +
                                              (student.missed ?? 0) ===
                                              0
                                          }
                                          title={
                                            (student.attended ?? 0) +
                                            (student.missed ?? 0) ===
                                            0
                                                ? "No actions to undo"
                                                : "Undo last action"
                                          }
                                      >
                                        Undo
                                      </button>

                                      {userRole === "superuser" && (
                                          <>
                                            <button
                                                type="button"
                                                className="reset-btn"
                                                onClick={() =>
                                                    handleResetCourse(student.student_id)
                                                }
                                            >
                                              Reset
                                            </button>
                                            <button
                                                type="button"
                                                className="delete-btn"
                                                onClick={() =>
                                                    deleteStudent(
                                                        student.student_id,
                                                        student.student_name,
                                                    )
                                                }
                                            >
                                              Delete
                                            </button>
                                          </>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                            );
                          })}
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
