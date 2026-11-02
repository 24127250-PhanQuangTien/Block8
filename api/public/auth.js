for (const form of document.querySelectorAll('form[method="post"]')) {
  const csrfInput = form.querySelector('input[name="_csrf"]');
  if (!csrfInput) continue;

  let refreshing = false;
  form.addEventListener("submit", async (event) => {
    if (refreshing) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    refreshing = true;
    const submitButton = form.querySelector('button[type="submit"], button:not([type])');
    if (submitButton) submitButton.disabled = true;

    try {
      const response = await fetch("/csrf-token", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("CSRF token could not be refreshed.");
      const result = await response.json();
      if (typeof result.token !== "string" || !result.token) {
        throw new Error("CSRF token response was invalid.");
      }
      csrfInput.value = result.token;
      form.submit();
    } catch {
      let notice = form.querySelector("[data-csrf-refresh-error]");
      if (!notice) {
        notice = document.createElement("p");
        notice.dataset.csrfRefreshError = "";
        notice.className = "error";
        notice.setAttribute("role", "alert");
        form.prepend(notice);
      }
      notice.textContent = "Không thể xác minh phiên đăng nhập. Hãy tải lại trang và thử lại.";
      refreshing = false;
      if (submitButton) submitButton.disabled = false;
    }
  });
}

for (const widget of document.querySelectorAll("[data-captcha-purpose]")) {
  const image = widget.querySelector("img");
  const challengeInput = widget.querySelector('[name="captchaChallengeId"]');
  const answerInput = widget.querySelector('[name="captchaAnswer"]');
  const refreshButton = widget.querySelector(".captcha-refresh");

  async function refreshCaptcha() {
    refreshButton.disabled = true;
    challengeInput.value = "";
    answerInput.value = "";
    try {
      const purpose = encodeURIComponent(widget.dataset.captchaPurpose);
      const response = await fetch(`/captcha/new?purpose=${purpose}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error("CAPTCHA could not be loaded.");
      const challenge = await response.json();
      challengeInput.value = challenge.challengeId;
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(challenge.svg)}`;
      image.hidden = false;
    } catch {
      image.hidden = true;
      widget.querySelector('[aria-live="polite"]').textContent = "Không tải được mã. Hãy thử đổi mã.";
    } finally {
      refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener("click", refreshCaptcha);
  if (!challengeInput.value) void refreshCaptcha();
}
