import { ArrowRight, Menu, X } from "lucide-react";
import React, { useState, useEffect, useRef } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { apiFetch } from "../apiClient";

export default function Navbar() {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith("/admin");
  const [isScrolled, setIsScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [logoutError, setLogoutError] = useState("");
  const toggleRef = useRef(null);
  const panelRef = useRef(null);

  function closeMenu(restoreFocus = false)
  {
    setMenuOpen(false);
    if (restoreFocus)
    {
      toggleRef.current?.focus({ preventScroll: true });
    }
  }

  function handleNavigationClick(event)
  {
    if (event.target.closest("a"))
    {
      closeMenu();
    }
  }

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 60);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    let active = true;
    apiFetch("/api/me")
      .then((response) => response.ok ? response.json() : null)
      .then((user) => {
        if (active && user?.email) setEmail(user.email);
      })
      .catch((error) => {
        if (active) {
          console.error("Could not load the signed-in account.", { name: error.name });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleLogout() {
    try {
      const response = await apiFetch("/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout request was rejected.");
      window.location.assign("/login");
    } catch (error) {
      setLogoutError("Đăng xuất chưa thành công. Vui lòng thử lại.");
      console.error("Logout request failed.", { name: error.name });
    }
  }

  // Đóng menu mobile khi chuyển route
  useEffect(() =>
  {
    setMenuOpen(false);
  }, [location]);

  useEffect(() =>
  {
    const mobile = window.matchMedia("(max-width: 768px)");
    function handleBreakpointChange()
    {
      setMenuOpen(false);
    }
    mobile.addEventListener("change", handleBreakpointChange);
    return () => mobile.removeEventListener("change", handleBreakpointChange);
  }, []);

  useEffect(() =>
  {
    if (!menuOpen)
    {
      return;
    }
    const body = document.body;
    const overflow = body.style.getPropertyValue("overflow");
    const priority = body.style.getPropertyPriority("overflow");
    body.style.setProperty("overflow", "hidden");
    panelRef.current?.querySelector("a")?.focus({ preventScroll: true });
    function handleEscape(event)
    {
      if (event.key === "Escape")
      {
        event.preventDefault();
        closeMenu(true);
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () =>
    {
      document.removeEventListener("keydown", handleEscape);
      if (overflow)
      {
        body.style.setProperty("overflow", overflow, priority);
      }
      else
      {
        body.style.removeProperty("overflow");
      }
    };
  }, [menuOpen]);

  return (
    <nav
      aria-label="Điều hướng chính"
      className={`navbar ${isAdmin ? "navbar--admin" : ""} ${isScrolled ? "navbar--scrolled" : ""}`}
      onBlur={(event) =>
      {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget))
        {
          closeMenu();
        }
      }}
    >
      {menuOpen && (
        <button
          type="button"
          className="navbar__backdrop"
          tabIndex={-1}
          aria-label="Đóng menu bằng vùng ngoài"
          onClick={() => closeMenu(true)}
        />
      )}
      <div className="container navbar__inner">
        {isAdmin ? (
          /* ==================== PHÍA QUẢN TRỊ (ADMIN) ==================== */
          <>
            <Link to="/admin/dishes" className="navbar__logo" onFocus={() => closeMenu()}>
              <img src="/assets/img/logo-white.svg" alt="RESTORAN ADMIN" />
            </Link>

            <div ref={panelRef} id="main-navigation" className={`navbar__menu ${menuOpen ? "open" : ""}`} onClick={handleNavigationClick}>
              <NavLink
                to="/admin/dishes"
                className={({ isActive }) =>
                  `navbar__link ${location.pathname.startsWith("/admin/dishes") ? "navbar__link--active" : ""}`
                }
              >
                Món Ăn
              </NavLink>

              <NavLink
                to="/admin/chefs"
                className={({ isActive }) =>
                  `navbar__link ${location.pathname.startsWith("/admin/chefs") ? "navbar__link--active" : ""}`
                }
              >
                Đầu Bếp
              </NavLink>

              <NavLink
                to="/admin/ingredients"
                className={({ isActive }) =>
                  `navbar__link ${location.pathname.startsWith("/admin/ingredients") ? "navbar__link--active" : ""}`
                }
              >
                Nguyên Liệu
              </NavLink>

              <Link to="/dishes" className="navbar__link navbar__link--client">
                Xem Trang Khách <ArrowRight className="ui-icon" aria-hidden="true" />
              </Link>
            </div>
          </>
        ) : (
          /* ==================== PHÍA THỰC KHÁCH (CLIENT) ==================== */
          <>
            <Link to="/dishes" className="navbar__logo" onFocus={() => closeMenu()}>
              <img src="/assets/img/logo-white.svg" alt="RESTORAN" />
            </Link>

            <div ref={panelRef} id="main-navigation" className={`navbar__menu ${menuOpen ? "open" : ""}`} onClick={handleNavigationClick}>
              <NavLink
                to="/dishes"
                end
                className={({ isActive }) =>
                  `navbar__link ${isActive ? "navbar__link--active" : ""}`
                }
              >
                Thực Đơn
              </NavLink>

              <Link to="/admin/dishes" className="navbar__link navbar__link--admin">
                Cổng Quản Trị
              </Link>
            </div>
          </>
        )}

        <div className="navbar__session">
          <span className="navbar__email" title={email}>{email}</span>
          {logoutError && <span role="alert">{logoutError}</span>}
          <button type="button" className="navbar__logout" onClick={handleLogout}>Đăng xuất</button>
        </div>

        <button
          ref={toggleRef}
          type="button"
          className={`navbar__toggle ${menuOpen ? "active" : ""}`}
          aria-label={menuOpen ? "Đóng menu điều hướng" : "Mở menu điều hướng"}
          aria-expanded={menuOpen}
          aria-controls="main-navigation"
          onClick={() =>
          {
            if (menuOpen)
            {
              closeMenu(true);
            }
            else
            {
              setMenuOpen(true);
            }
          }}
        >
          {menuOpen ? <X className="ui-icon ui-icon--menu" aria-hidden="true" /> : <Menu className="ui-icon ui-icon--menu" aria-hidden="true" />}
        </button>
      </div>
    </nav>
  );
}
