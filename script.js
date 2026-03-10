// Smooth scroll para links e botões com data-scroll
function setupSmoothScroll() {
  const triggers = document.querySelectorAll("[data-scroll]");

  triggers.forEach((el) => {
    el.addEventListener("click", (event) => {
      event.preventDefault();

      const targetSelector =
        el.getAttribute("data-target") || el.getAttribute("href");
      if (!targetSelector || !targetSelector.startsWith("#")) return;

      const target = document.querySelector(targetSelector);
      if (!target) return;

      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

// Menu mobile
function setupNavbarToggle() {
  const toggle = document.getElementById("navbarToggle");
  const menu = document.getElementById("navbarMenu");

  if (!toggle || !menu) return;

  toggle.addEventListener("click", () => {
    menu.classList.toggle("open");
  });

  // Fechar ao clicar em um link
  menu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      menu.classList.remove("open");
    });
  });
}

// Painel lateral direito: Áreas do Sistema
function setupSystemPanel() {
  const toggle = document.getElementById("systemMenuToggle");
  const panel = document.getElementById("systemPanel");
  const overlay = document.getElementById("systemPanelOverlay");
  const closers = document.querySelectorAll("[data-system-close]");

  if (!toggle || !panel || !overlay) return;

  const openPanel = () => {
    panel.classList.add("open");
    overlay.classList.add("open");
    document.body.classList.add("system-menu-open");
    toggle.setAttribute("aria-expanded", "true");
  };

  const closePanel = () => {
    panel.classList.remove("open");
    overlay.classList.remove("open");
    document.body.classList.remove("system-menu-open");
    toggle.setAttribute("aria-expanded", "false");
  };

  toggle.addEventListener("click", () => {
    if (panel.classList.contains("open")) {
      closePanel();
      return;
    }
    openPanel();
  });

  closers.forEach((el) => {
    el.addEventListener("click", closePanel);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closePanel();
    }
  });
}

// Botão de voltar ao topo
function setupBackToTop() {
  const button = document.getElementById("backToTop");
  if (!button) return;

  window.addEventListener("scroll", () => {
    const scrolled = window.scrollY || document.documentElement.scrollTop;
    if (scrolled > 300) {
      button.classList.add("visible");
    } else {
      button.classList.remove("visible");
    }
  });

  button.addEventListener("click", () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  });
}

// Animação de revelação ao rolar (IntersectionObserver)
function setupRevealOnScroll() {
  const items = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window) || items.length === 0) {
    // Fallback: mostra tudo se o recurso não existir
    items.forEach((el) => el.classList.add("visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          obs.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.15,
    }
  );

  items.forEach((el) => observer.observe(el));
}

// Inicialização geral
document.addEventListener("DOMContentLoaded", () => {
  setupSmoothScroll();
  setupNavbarToggle();
  setupSystemPanel();
  setupBackToTop();
  setupRevealOnScroll();
});
