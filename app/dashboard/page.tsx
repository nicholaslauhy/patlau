"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import AppHeader from "./../components/AppHeader";
import "./../styles.css";
import "./dashboard.css";
import { Student } from "../../types/supabase";

type UserRole = "superuser" | "admin" | "member";
type AuditAction = "mark" | "makeup" | "undo" | "delete" | "reset" | "missed";

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
  const [userRole, setUserRole] = useState<UserRole | null>(null);

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


  type AttendanceStatus = "mark" | "missed" | "makeup";

  const makeAttendanceRecord = (
      dateIso: string,
      status: AttendanceStatus = "mark",
      originalMissedDate?: string,
  ) => {
    if (status === "mark") {
      return dateIso;
    }

    if (status === "makeup" && originalMissedDate) {
      return `${dateIso}|makeup|${originalMissedDate}`;
    }

    return `${dateIso}|${status}`;
  };

  const parseAttendanceRecord = (record: unknown) => {
    const raw = String(record || "");

    if (raw.includes("|")) {
      const [dateIso, statusRaw, originalMissedDate] = raw.split("|");
      const status = ["missed", "makeup"].includes(statusRaw)
          ? (statusRaw as AttendanceStatus)
          : "mark";

      return { dateIso, status, originalMissedDate };
    }

    const legacyMissedMatch = raw.match(/^(.*)\s+\(missed\)$/i);
    if (legacyMissedMatch) {
      return {
        dateIso: legacyMissedMatch[1],
        status: "missed" as AttendanceStatus,
        originalMissedDate: undefined,
      };
    }

    const legacyMakeupMatch = raw.match(/^(.*)\s+\(makeup\)$/i);
    if (legacyMakeupMatch) {
      return {
        dateIso: legacyMakeupMatch[1],
        status: "makeup" as AttendanceStatus,
        originalMissedDate: undefined,
      };
    }

    return {
      dateIso: raw,
      status: "mark" as AttendanceStatus,
      originalMissedDate: undefined,
    };
  };

  const findLastRecordIndexByStatus = (
      records: unknown[],
      statuses: AttendanceStatus[],
  ) => {
    for (let i = records.length - 1; i >= 0; i--) {
      const parsed = parseAttendanceRecord(records[i]);
      if (statuses.includes(parsed.status)) {
        return i;
      }
    }

    return -1;
  };

  const removeLastRecordByStatus = (
      records: unknown[],
      statuses: AttendanceStatus[],
  ) => {
    const nextRecords = [...records];
    const index = findLastRecordIndexByStatus(nextRecords, statuses);

    if (index !== -1) {
      nextRecords.splice(index, 1);
      return nextRecords;
    }

    if (nextRecords.length > 0) {
      nextRecords.pop();
    }

    return nextRecords;
  };

  const formatAttendanceRecord = (record: unknown) => {
    const { dateIso, status } = parseAttendanceRecord(record);
    const parsedDate = new Date(dateIso);
    const readableDate = Number.isNaN(parsedDate.getTime())
        ? String(dateIso)
        : parsedDate.toLocaleDateString();

    if (status === "missed") {
      return `${readableDate} (missed)`;
    }

    if (status === "makeup") {
      return `${readableDate} (makeup)`;
    }

    return readableDate;
  };

  const canEditStudentFields = userRole === "superuser";
  const isSuperuser = userRole === "superuser";

  useEffect(() => {
    const loadUserProfileAndRole = async () => {
      try {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();

        if (error || !user) {
          router.push("/");
          return;
        }

        const displayName =
            user.user_metadata?.name || user.email?.split("@")[0] || "User";

        /**
         * IMPORTANT:
         * This assumes your Supabase role is stored in user_metadata.role.
         * If you store role in app_metadata instead, change this to:
         *
         * const role =
         *   (user.app_metadata?.role as UserRole | undefined) || "member";
         */
        const role =
            (user.user_metadata?.role as UserRole | undefined) || "member";

        setUserName(displayName);
        setUserEmail(user.email || "");
        setUserRole(role);
      } catch (err) {
        console.error("Failed to load user profile:", err);
        router.push("/");
      }
    };

    loadUserProfileAndRole();
  }, [router]);

  const logAuditAction = async (studentId: string, action: AuditAction) => {
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

  /**
   * Members should see all student records on the dashboard.
   * Previously, members were filtered by matching student_name against the member's
   * own name/email. That made the table empty for normal member accounts.
   */
  const getVisibleStudents = (students: Student[]) => {
    return students;
  };

  const fetchData = useCallback(async () => {
    if (userRole === null) return;

    setIsLoading(true);
    setMessage(null);

    try {
      let query = supabase.from("students").select("*");

      if (selectedDay !== "all") {
        query = query.eq("student_day", selectedDay);
      }

      if (selectedTimeslot !== "all") {
        query = query.eq("student_timeslot", selectedTimeslot);
      }

      if (selectedLevel !== "all") {
        query = query.eq("student_levelofplay", selectedLevel);
      }

      const { data, error } = await query.order("student_name", {
        ascending: true,
      });

      if (error) {
        console.error("Failed to load student records:", error);
        setSearchResults([]);
        setMessage("Failed to load student records.");
        return;
      }

      const visibleData = getVisibleStudents(Array.isArray(data) ? data : []);

      setSearchResults(visibleData);
      setMessage(visibleData.length === 0 ? "No student records found." : null);
    } catch (err) {
      console.error("Failed to load student records:", err);
      setSearchResults([]);
      setMessage("Failed to load student records.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedDay, selectedTimeslot, selectedLevel, userRole]);

  const deleteStudent = async (studentId: string, studentName?: string) => {
    if (userRole !== "superuser") {
      alert("Only superusers can delete students.");
      return;
    }

    if (!confirm(`Delete ${studentName ?? "this student"}? This cannot be undone.`)) {
      return;
    }

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
      await fetchData();
    } catch (err: any) {
      alert(`Delete failed: ${err?.message ?? "Unknown error"}`);
    }
  };

  const handleDeleteLastAttendance = async (studentId: string) => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("Not authenticated");

      // Load current student row
      const { data: studentData, error: fetchError } = await supabase
          .from("students")
          .select("*")
          .eq("student_id", studentId)
          .single();

      if (fetchError || !studentData) {
        throw fetchError || new Error("Student not found");
      }

      // Fetch full recent action history, INCLUDING undo
      // This is important because every "undo" should cancel one previous
      // mark/makeup/missed action.
      const { data: auditLogs, error: auditError } = await supabase
          .from("student_audit")
          .select("*")
          .eq("student_id", studentId)
          .in("action", ["mark", "makeup", "missed", "undo"])
          .order("created_at", { ascending: false })
          .limit(100);

      if (auditError) throw auditError;

      const logs = Array.isArray(auditLogs) ? auditLogs : [];

      let undoCount = 0;
      let actionToUndo: any = null;

      for (const log of logs) {
        if (log.action === "undo") {
          undoCount += 1;
          continue;
        }

        if (["mark", "makeup", "missed"].includes(log.action)) {
          if (undoCount > 0) {
            // This action has already been cancelled by a later undo.
            undoCount -= 1;
            continue;
          }

          // This is the latest attendance action that has NOT been undone yet.
          actionToUndo = log;
          break;
        }
      }

      if (!actionToUndo) {
        alert("Nothing to undo.");
        return;
      }

      let newAttended = studentData.attended ?? 0;
      let newMissed = studentData.missed ?? 0;
      let newRecords = Array.isArray(studentData.attendance_records)
          ? [...studentData.attendance_records]
          : [];

      if (actionToUndo.action === "mark") {
        // Original mark: attended + 1
        // Undo mark: attended - 1 and remove latest normal attendance record.
        newAttended = Math.max(0, newAttended - 1);
        newRecords = removeLastRecordByStatus(newRecords, ["mark"]);
      } else if (actionToUndo.action === "missed") {
        // Original missed: missed + 1
        // Undo missed: missed - 1 and remove latest missed history row.
        newMissed = Math.max(0, newMissed - 1);
        newRecords = removeLastRecordByStatus(newRecords, ["missed"]);
      } else if (actionToUndo.action === "makeup") {
        // Original makeup: missed - 1, attended + 1
        // Undo makeup: attended - 1, missed + 1 and restore the missed history row.
        newAttended = Math.max(0, newAttended - 1);
        newMissed = newMissed + 1;

        const makeupRecordIndex = findLastRecordIndexByStatus(newRecords, ["makeup"]);
        if (makeupRecordIndex !== -1) {
          const makeupRecord = parseAttendanceRecord(newRecords[makeupRecordIndex]);
          const missedDateToRestore = makeupRecord.originalMissedDate || makeupRecord.dateIso;
          newRecords[makeupRecordIndex] = makeAttendanceRecord(missedDateToRestore, "missed");
        } else {
          newRecords = removeLastRecordByStatus(newRecords, ["makeup"]);
        }
      } else {
        alert("Last action cannot be undone.");
        return;
      }

      const { data: updatedStudent, error: updateError } = await supabase
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

      if (updateError || !updatedStudent) {
        throw updateError || new Error("Update failed");
      }

      // Update only this row locally instead of refetching the whole dashboard.
      // This prevents the table from flashing/reloading after Undo.
      setSearchResults((prev) =>
          prev.map((s) => (s.student_id === studentId ? updatedStudent : s)),
      );
      setMessage(null);

      // Log this undo. Future undo presses will now skip the action we just reversed.
      await logAuditAction(studentId, "undo");
    } catch (err: any) {
      alert(`Failed to undo attendance: ${err?.message ?? "Unknown error"}`);
    }
  };

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

      if (fetchError || !studentData) {
        throw fetchError || new Error("Student not found");
      }

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

      const nowIso = new Date().toISOString();
      const newAttended = attended + 1;
      const currentRecords = Array.isArray(studentData.attendance_records)
          ? [...studentData.attendance_records]
          : [];
      const newRecords = [...currentRecords, makeAttendanceRecord(nowIso, "mark")];

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

      if (fetchError || !studentData) {
        throw fetchError || new Error("Student not found");
      }

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

      const nowIso = new Date().toISOString();
      const newAttended = attended + 1;
      const newMissed = Math.max(0, missed - 1);
      const newRecords = Array.isArray(studentData.attendance_records)
          ? [...studentData.attendance_records]
          : [];

      const missedRecordIndex = findLastRecordIndexByStatus(newRecords, ["missed"]);

      if (missedRecordIndex !== -1) {
        const missedRecord = parseAttendanceRecord(newRecords[missedRecordIndex]);
        newRecords[missedRecordIndex] = makeAttendanceRecord(
            nowIso,
            "makeup",
            missedRecord.dateIso,
        );
      } else {
        newRecords.push(makeAttendanceRecord(nowIso, "makeup"));
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

      setSearchResults((prev) =>
          prev.map((s) => (s.student_id === studentId ? updatedStudent : s)),
      );

      await logAuditAction(studentId, "makeup");
    } catch (err: any) {
      alert(`Failed to record makeup attendance: ${err?.message ?? "Unknown error"}`);
    }
  };

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

      if (fetchError || !studentData) {
        throw fetchError || new Error("Student not found");
      }

      const attended = studentData.attended ?? 0;
      const missed = studentData.missed ?? 0;
      const totalWeeks = studentData.total_weeks ?? 0;

      if (attended + missed >= totalWeeks) {
        alert("Total lessons for this subscription have already been used.");
        return;
      }

      const nowIso = new Date().toISOString();
      const newMissed = missed + 1;
      const currentRecords = Array.isArray(studentData.attendance_records)
          ? [...studentData.attendance_records]
          : [];
      const newRecords = [...currentRecords, makeAttendanceRecord(nowIso, "missed")];

      const { data: updatedStudent, error } = await supabase
          .from("students")
          .update({
            missed: newMissed,
            attendance_records: newRecords,
            updated_at: nowIso,
          })
          .eq("student_id", studentId)
          .select()
          .single();

      if (error || !updatedStudent) throw error || new Error("Update failed");

      setSearchResults((prev) =>
          prev.map((s) => (s.student_id === studentId ? updatedStudent : s)),
      );

      await logAuditAction(studentId, "missed");
    } catch (err: any) {
      alert(`Failed to mark missed: ${err?.message ?? "Unknown error"}`);
    }
  };

  const handleResetCourse = async (studentId: string) => {
    if (userRole !== "superuser") {
      alert("Only superusers can reset courses.");
      return;
    }

    if (!confirm("Reset this course? This will clear attended and missed counts.")) {
      return;
    }

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
      if (userRole === null) return;

      const term = searchTerm.trim();

      if (term.length === 0) {
        await fetchData();
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
        const results = getVisibleStudents(data.results || []);

        setSearchResults(results);
        setMessage(results.length === 0 ? "No student records found." : null);
      } catch (err) {
        console.error("Search failed:", err);
        setSearchResults([]);
        setMessage("Search failed.");
      }
    }, 300);

    return () => clearTimeout(handler);
  }, [searchTerm, userRole, fetchData]);

  useEffect(() => {
    if (userRole !== null) {
      fetchData();
    }
  }, [fetchData, userRole]);

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

            {!isLoading && Array.isArray(searchResults) && searchResults.length > 0 && (
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
                        <th className="actions-header">Actions</th>
                        <th>Attendance History</th>
                      </tr>
                      </thead>
                      <tbody>
                      {searchResults.map((student) => {
                        const attended = student.attended ?? 0;
                        const missed = student.missed ?? 0;
                        const lessonsUsed = attended + missed;
                        const finished = lessonsUsed >= (student.total_weeks ?? 0);

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
                                                          updated_at: new Date().toISOString(),
                                                        }
                                                        : s,
                                                ),
                                            );
                                          } catch (err: any) {
                                            alert(`Failed to update day: ${err?.message ?? "Unknown error"}`);
                                          }
                                        }}
                                    >
                                      <option value="Saturday">Saturday</option>
                                      <option value="Sunday">Sunday</option>
                                    </select>
                                ) : (
                                    <span
                                        title="Only superusers can change this"
                                        style={{ cursor: "not-allowed", opacity: 0.7 }}
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
                                                          updated_at: new Date().toISOString(),
                                                        }
                                                        : s,
                                                ),
                                            );
                                          } catch (err: any) {
                                            alert(`Failed to update timeslot: ${err?.message ?? "Unknown error"}`);
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
                                        style={{ cursor: "not-allowed", opacity: 0.7 }}
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
                                                          updated_at: new Date().toISOString(),
                                                        }
                                                        : s,
                                                ),
                                            );
                                          } catch (err: any) {
                                            alert(`Failed to update level: ${err?.message ?? "Unknown error"}`);
                                          }
                                        }}
                                    >
                                      <option value="Beginner">Beginner</option>
                                      <option value="Intermediate">Intermediate</option>
                                      <option value="Advanced">Advanced</option>
                                    </select>
                                ) : (
                                    <span
                                        title="Only superusers can change this"
                                        style={{ cursor: "not-allowed", opacity: 0.7 }}
                                    >
                                {student.student_levelofplay}
                              </span>
                                )}
                              </td>

                              <td className="lessons-count" title={`${attended} attended`}>
                                {attended}
                              </td>
                              <td className="missed-count" title={`${missed} missed`}>
                                {missed}
                              </td>

                              <td className="actions-cell">
                                <div className={isSuperuser ? "actions-stack" : "actions-stack actions-stack-single"}>
                                  <div className="actions-row actions-primary-row">
                                    <button
                                        type="button"
                                        className="attendance-btn"
                                        onClick={() => handleAttendanceClick(student.student_id)}
                                        disabled={finished}
                                        title={finished ? "Subscription lessons completed" : "Mark attended"}
                                    >
                                      Mark
                                    </button>

                                    <button
                                        type="button"
                                        className="missed-btn"
                                        onClick={() => handleMissed(student.student_id)}
                                        disabled={finished}
                                        title={finished ? "Subscription lessons completed" : "Mark missed"}
                                    >
                                      Missed
                                    </button>

                                    <button
                                        type="button"
                                        className="makeup-btn"
                                        onClick={() => handleMakeupAttendance(student.student_id)}
                                        disabled={finished || (student.missed ?? 0) <= 0}
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
                                        onClick={() => handleDeleteLastAttendance(student.student_id)}
                                        disabled={(student.attended ?? 0) + (student.missed ?? 0) === 0}
                                        title={
                                          (student.attended ?? 0) + (student.missed ?? 0) === 0
                                              ? "No actions to undo"
                                              : "Undo last action"
                                        }
                                    >
                                      Undo
                                    </button>
                                  </div>

                                  {isSuperuser && (
                                      <div className="actions-row actions-admin-row">
                                        <button
                                            type="button"
                                            className="reset-btn"
                                            onClick={() => handleResetCourse(student.student_id)}
                                        >
                                          Reset
                                        </button>
                                        <button
                                            type="button"
                                            className="delete-btn"
                                            onClick={() =>
                                                deleteStudent(student.student_id, student.student_name)
                                            }
                                        >
                                          Delete
                                        </button>
                                      </div>
                                  )}
                                </div>
                              </td>
                              <td className="attendance-history">
                                {Array.isArray(student.attendance_records) &&
                                student.attendance_records.length > 0 ? (
                                    <ul>
                                      {student.attendance_records.map((record, index) => (
                                          <li key={index}>{formatAttendanceRecord(record)}</li>
                                      ))}
                                    </ul>
                                ) : (
                                    <span className="muted">No history</span>
                                )}
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
