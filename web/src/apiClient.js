// Nơi duy nhất định nghĩa URL gốc của API (Slide 29, 50)
export const API_BASE_URL = "/api";

let csrfTokenPromise;

async function getCsrfToken() {
  if (!csrfTokenPromise) {
    csrfTokenPromise = fetch("/api/csrf", { credentials: "same-origin" })
      .then(async (response) => {
        if (response.redirected && new URL(response.url).pathname === "/login") {
          window.location.assign("/login");
          throw new Error("Authentication required.");
        }
        if (!response.ok) throw new Error("Không lấy được mã CSRF.");
        return (await response.json()).token;
      })
      .catch((error) => {
        csrfTokenPromise = undefined;
        throw error;
      });
  }
  return csrfTokenPromise;
}

export async function apiFetch(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = { ...options.headers };
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers["X-CSRF-Token"] = await getCsrfToken();
  }
  const response = await fetch(url, {
    ...options,
    method,
    headers,
    credentials: "same-origin",
  });
  if (response.redirected && new URL(response.url).pathname === "/login") {
    window.location.assign("/login");
    throw new Error("Authentication required.");
  }
  return response;
}

/**
 * Hàm gọi API tổng quát bóc tách chính xác 3 tầng lỗi theo tiêu chuẩn bài giảng
 * @param {string} endpoint - Ví dụ: '/dishes', '/dishes/2'
 * @param {object} options - Cấu hình fetch (method, headers, body...)
 * @returns {Promise<any>} data trả về khi ok: true
 */
export async function apiRequest(endpoint, options = {}) {
  let response;

  // --- TẦNG 1: Kiểm tra lỗi mạng hoặc bị CORS chặn ---
  try {
    response = await apiFetch(`${API_BASE_URL}${endpoint}`, {
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...options,
    });
  } catch (networkError) {
    if (networkError.name === "AbortError") throw networkError;
    throw {
      type: "NETWORK_ERROR",
      isTechnical: true,
      message: "Không thể kết nối. Vui lòng kiểm tra lại đường truyền mạng hoặc thử lại sau.",
    };
  }

  // --- TẦNG 2: Kiểm tra lỗi kỹ thuật HTTP Status (404 sai URL, 500 lỗi máy chủ) ---
  if (!response.ok) {
    const errMessage = response.status === 404
      ? "Không tìm thấy thông tin bạn yêu cầu."
      : response.status === 401 || response.status === 403
        ? "Bạn không có quyền thực hiện thao tác này."
        : response.status === 429
          ? "Vui lòng đợi một lát rồi thử lại."
          : "Không thể hoàn tất yêu cầu lúc này. Vui lòng thử lại sau.";

    throw {
      type: "HTTP_ERROR",
      isTechnical: true,
      status: response.status,
      message: errMessage,
    };
  }

  // Đọc dữ liệu JSON
  let payload;
  try {
    payload = await response.json();
  } catch (jsonErr) {
    throw {
      type: "PARSE_ERROR",
      isTechnical: true,
      message: "Không thể xử lý dữ liệu. Vui lòng thử lại sau.",
    };
  }

  // --- TẦNG 3: Kiểm tra lỗi nghiệp vụ (ok: false) ---
  if (!payload.ok) {
    throw {
      type: "BUSINESS_ERROR",
      isTechnical: false,
      code: payload.error?.code || "UNKNOWN_BUSINESS_ERROR",
      message: payload.error?.message || "Không thể hoàn tất thao tác. Vui lòng thử lại.",
      fields: payload.error?.fields || {},
    };
  }

  // Thành công hoàn toàn -> trả về dữ liệu nghiệp vụ sạch
  return payload.data;
}

// ==================== CÁC HÀM TIỆN ÍCH CHO MÓN ĂN ====================
export const dishApi = {
  listPage: (params = {}, signal) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
    });
    return apiRequest(`/dishes?${query.toString()}`, { signal });
  },
  list: (params = {}) => {
    const query = {
      mode: params.category || params.status ? "advanced" : "basic",
      sort: params.sort === "name" ? "name_asc" : params.sort || "id_asc",
      page: 1,
      pageSize: 100,
    };
    if (params.q) query.q = params.q;
    if (params.category) query.category = params.category;
    if (params.status === "available") query.available = "true";
    if (params.status === "unavailable") query.available = "false";

    const loadAll = async () => {
      const first = await dishApi.listPage(query);
      const items = [...first.items];
      for (let page = 2; page <= Math.ceil(first.total / first.pageSize); page += 1) {
        const result = await dishApi.listPage({ ...query, page });
        items.push(...result.items);
      }
      return items;
    };
    return loadAll();
  },
  getById: (id) => apiRequest(`/dishes/${id}`),
  create: (data) =>
    apiRequest("/dishes", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id, data) =>
    apiRequest(`/dishes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  delete: (id) =>
    apiRequest(`/dishes/${id}`, {
      method: "DELETE",
    }),
};

// ==================== CÁC HÀM TIỆN ÍCH CHO ĐẦU BẾP ====================
export const chefApi = {
  list: (params = {}, signal) => {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    const qs = query.toString() ? `?${query.toString()}` : "";
    return apiRequest(`/chefs${qs}`, { signal });
  },
  getById: (id) => apiRequest(`/chefs/${id}`),
  create: (data) =>
    apiRequest("/chefs", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id, data) =>
    apiRequest(`/chefs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  delete: (id) =>
    apiRequest(`/chefs/${id}`, {
      method: "DELETE",
    }),
};

// ==================== CÁC HÀM TIỆN ÍCH CHO NGUYÊN LIỆU ====================
export const ingredientApi = {
  list: (params = {}, signal) => {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.category) query.set("category", params.category);
    if (params.unit) query.set("unit", params.unit);
    if (params.mode) query.set("mode", params.mode);
    if (params.match) query.set("match", params.match);
    const qs = query.toString() ? `?${query.toString()}` : "";
    return apiRequest(`/ingredients${qs}`, { signal });
  },
  getById: (id) => apiRequest(`/ingredients/${id}`),
  create: (data) =>
    apiRequest("/ingredients", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id, data) =>
    apiRequest(`/ingredients/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  delete: (id) =>
    apiRequest(`/ingredients/${id}`, {
      method: "DELETE",
    }),
};
