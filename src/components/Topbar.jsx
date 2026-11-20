import { useState, useRef, useEffect } from "react";
import {
    FaChevronDown,
    FaChevronRight,
    FaCheckCircle,
    FaShieldAlt,
    FaUserCheck,
    FaBuilding,
    FaSignOutAlt,
    FaTrashAlt,
    FaExclamationTriangle
} from "react-icons/fa";
import { getPageMeta } from "../data/navigationStructure";
import "../styles/topbar.css";

// A reset can be destructive even when its HTTP confirmation is lost.
// Never interpret an empty body or an interrupted connection as a failed reset.
const UNCERTAIN_RESET =
    "The reset connection ended without a valid confirmation. The reset may already have completed. Check your local imported files and Supabase records before trying again.";

async function readResetResponse(response) {
    let body;
    try {
        body = await response.text();
    } catch {
        throw new Error(UNCERTAIN_RESET);
    }
    if (!body || !body.trim()) {
        throw new Error(UNCERTAIN_RESET);
    }
    let result;
    try {
        result = JSON.parse(body);
    } catch {
        throw new Error(UNCERTAIN_RESET);
    }
    if (!result || typeof result !== "object" || result.success !== true || !response.ok) {
        throw new Error(typeof result?.error === "string" && result.error
            ? result.error
            : `Reset was not confirmed (HTTP ${response.status}).`);
    }
    return result;
}

export default function Topbar({
    activePage = "overview",
    activeSection = null,
    scope = null,
    onLogout = () => {}
}) {
    const [profileOpen, setProfileOpen] = useState(false);
    const [resetOpen, setResetOpen] = useState(false);
    const [resetMode, setResetMode] = useState("local");
    const [resetPassword, setResetPassword] = useState("");
    const [resetError, setResetError] = useState("");
    const [resetBusy, setResetBusy] = useState(false);
    async function confirmReset(event) {
        event.preventDefault();
        if (!resetPassword || resetBusy) return;
        setResetBusy(true);
        setResetError("");
        try {
            const response = await fetch("/api/application/reset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password: resetPassword, mode: resetMode })
            });
            await readResetResponse(response);
            setResetOpen(false);
            setResetPassword("");
            // Force data pages to request new source / staging state after reset.
            window.location.reload();
        } catch (error) {
            setResetError(error instanceof TypeError
                ? UNCERTAIN_RESET
                : (error.message || "Reset could not be completed."));
        } finally {
            setResetBusy(false);
        }
    }
    function dismissReset() {
        if (resetBusy) return;
        setResetOpen(false);
        setResetPassword("");
        setResetError("");
    }
    const profileRef = useRef(null);

    const pageMeta = getPageMeta(activePage);
    const subSectionMeta = pageMeta?.subSections?.find(s => s.id === activeSection);

    // Close profile dropdown on outside click
    useEffect(() => {
        function handleClickOutside(event) {
            if (profileRef.current && !profileRef.current.contains(event.target)) {
                setProfileOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    return (
        <header className="dss-topbar">
            {/* CORPORATE BREADCRUMB TRAIL */}
            <div className="topbar-breadcrumbs" aria-label="Breadcrumb">
                <span className="breadcrumb-root">SAIPHER CG DSS</span>
                <FaChevronRight className="breadcrumb-separator" aria-hidden="true" />
                
                <span className="breadcrumb-category">
                    {pageMeta.category}
                </span>
                <FaChevronRight className="breadcrumb-separator" aria-hidden="true" />

                <span className={`breadcrumb-page ${!subSectionMeta ? "current" : ""}`}>
                    {pageMeta.label}
                </span>

                {subSectionMeta && (
                    <>
                        <FaChevronRight className="breadcrumb-separator" aria-hidden="true" />
                        <span className="breadcrumb-sub current">
                            {subSectionMeta.label}
                        </span>
                    </>
                )}
            </div>

            {/* TOPBAR ACTIONS */}
            <div className="topbar-actions">
                {/* SYSTEM STATUS PILL */}
                <div className="topbar-status-chip" title="DSS Analytics Engine is operating normally">
                    <span className="status-dot-pulse" />
                    <span>System Online</span>
                </div>

                {/* USER PROFILE WITH CORPORATE DROPDOWN */}
                <div className="profile-container" ref={profileRef}>
                    <button
                        type="button"
                        className={`user-profile ${profileOpen ? "open" : ""}`}
                        onClick={() => setProfileOpen(!profileOpen)}
                        aria-expanded={profileOpen}
                        aria-haspopup="dialog"
                    >
                        <span className="user-avatar">
                            CG
                        </span>

                        <div className="user-info-text">
                            <span className="user-name">Client User</span>
                            <span className="user-role">Decision Maker</span>
                        </div>

                        <FaChevronDown className="user-chevron" aria-hidden="true" />
                    </button>

                    {profileOpen && (
                        <div className="profile-dropdown-card" role="dialog" aria-label="User Account Details">
                            <div className="dropdown-header">
                                <div className="dropdown-avatar-large">CG</div>
                                <div>
                                    <strong>Client User</strong>
                                    <small>Decision Maker</small>
                                </div>
                            </div>

                            <div className="dropdown-details">
                                <div className="detail-row">
                                    <FaBuilding className="detail-icon" />
                                    <div>
                                        <span>Organization</span>
                                        <strong>SAIPHER CG Commercial</strong>
                                    </div>
                                </div>

                                <div className="detail-row">
                                    <FaShieldAlt className="detail-icon" />
                                    <div>
                                        <span>Access Level</span>
                                        <strong>Enterprise Decision Support</strong>
                                    </div>
                                </div>

                                <div className="detail-row">
                                    <FaCheckCircle className="detail-icon verified" />
                                    <div>
                                        <span>Data Engine</span>
                                        <strong>Supabase Production</strong>
                                    </div>
                                </div>
                            </div>

                            <div className="dropdown-footer">
                                <span className="dropdown-system-label">SAIPHER CG DSS v1.0.0</span>
                                <button type="button" className="dropdown-reset" onClick={() => {
                                    setProfileOpen(false);
                                    setResetMode("local");
                                    setResetError("");
                                    setResetPassword("");
                                    setResetOpen(true);
                                }}>
                                    <FaTrashAlt aria-hidden="true" />
                                    Reset
                                </button>
                                <button type="button" className="dropdown-logout" onClick={() => {
                                    setProfileOpen(false);
                                    onLogout();
                                }}>
                                    <FaSignOutAlt aria-hidden="true" />
                                    Log out
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            {resetOpen && (
                <div className="reset-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) dismissReset(); }}>
                    <form className="reset-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-title" onSubmit={confirmReset}>
                        <h2 id="reset-title"><FaExclamationTriangle aria-hidden="true" /> Reset Application Data</h2>
                        <p>Choose what to clear from SAIPHER. This action permanently deletes the selected data.</p>
                        <label className={`reset-choice ${resetMode === "local" ? "selected" : ""}`}>
                            <input type="radio" name="reset-mode" value="local" checked={resetMode === "local"}
                                disabled={resetBusy} onChange={() => setResetMode("local")} />
                            <span><strong>Clear Local Database</strong><small>Deletes imported local files, registrations, mappings and prepared output. Supabase is unchanged.</small></span>
                        </label>
                        <label className={`reset-choice ${resetMode === "local_supabase" ? "selected" : ""}`}>
                            <input type="radio" name="reset-mode" value="local_supabase" checked={resetMode === "local_supabase"}
                                disabled={resetBusy} onChange={() => setResetMode("local_supabase")} />
                            <span><strong>Clear Local Database + Supabase</strong><small>Deletes local imported data and SAIPHER's related Supabase business data. Requires the new reset SQL.</small></span>
                        </label>
                        <label className="reset-password-label" htmlFor="reset-password">Current login password</label>
                        <input id="reset-password" type="password" autoComplete="current-password" required
                            placeholder="Enter password to confirm" value={resetPassword} disabled={resetBusy}
                            onChange={event => setResetPassword(event.target.value)} />
                        {resetError && <p className="reset-error" role="alert">{resetError}</p>}
                        <div className="reset-actions">
                            <button type="button" className="reset-cancel" disabled={resetBusy} onClick={dismissReset}>Cancel</button>
                            <button type="submit" className="reset-confirm" disabled={resetBusy || !resetPassword}>
                                {resetBusy ? "Clearing…" : "OK — Clear Data"}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </header>
    );
}
