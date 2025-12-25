/**
 * Mobile TOC - handles mobile table of contents functionality:
 * 1. Moves TOC from sidebar to collapsible container at article top
 * 2. Clones TOC content (without ID) into slide-out panel for FAB access
 *
 * This avoids duplicate #TableOfContents IDs (which caused PR #615 rejection)
 * while providing both "before reading" and "mid-article" TOC access.
 */

const CONFIG = {
    MOBILE_BREAKPOINT: 1024,
    SCROLL_DURATION: 600,
    SWIPE_THRESHOLD: 50,
    EDGE_ZONE: 30,
    FOCUS_DELAY: 100,
    COLLAPSE_DELAY: 150,
} as const;

const SELECTORS = {
    TOC_WIDGET: '.right-sidebar .widget--toc',
    TABLE_OF_CONTENTS: '#TableOfContents',
    MOBILE_CONTAINER: 'mobile-toc-container',
    MOBILE_CONTENT: 'mobile-toc-content',
    MOBILE_HEADER: 'mobile-toc-header',
    FAB: 'mobile-toc-fab',
    OVERLAY: 'mobile-toc-overlay',
    PANEL: 'mobile-toc-panel',
    PANEL_CONTENT: 'mobile-toc-panel-content',
    PANEL_CLOSE: 'mobile-toc-panel-close',
    PANEL_CLONE: '.toc-panel-clone',
} as const;

/**
 * Smooth scroll with ease-out cubic easing
 */
function smoothScrollTo(element: HTMLElement, duration = CONFIG.SCROLL_DURATION): void {
    const targetPosition = element.getBoundingClientRect().top + window.scrollY;
    const startPosition = window.scrollY;
    const distance = targetPosition - startPosition;
    let startTime: number | null = null;

    const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

    function animate(currentTime: number): void {
        if (startTime === null) startTime = currentTime;
        const progress = Math.min((currentTime - startTime) / duration, 1);

        window.scrollTo(0, startPosition + distance * easeOutCubic(progress));

        if (progress < 1) {
            requestAnimationFrame(animate);
        }
    }

    requestAnimationFrame(animate);
}

/**
 * Throttle function calls using requestAnimationFrame
 */
function throttleRAF<T extends (...args: unknown[]) => void>(fn: T): T {
    let scheduled = false;
    return ((...args: unknown[]) => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            fn(...args);
            scheduled = false;
        });
    }) as T;
}

/**
 * Get element by ID with type casting
 */
function getElement<T extends HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
}

class MobileTOC {
    // DOM Elements
    private readonly elements: {
        tocWidget: HTMLElement | null;
        sidebarContainer: HTMLElement | null;
        mobileContainer: HTMLElement | null;
        mobileContent: HTMLElement | null;
        mobileHeader: HTMLButtonElement | null;
        fab: HTMLButtonElement | null;
        overlay: HTMLElement | null;
        panel: HTMLElement | null;
        panelContent: HTMLElement | null;
        panelClose: HTMLButtonElement | null;
    };

    // State
    private isCollapsibleExpanded = false;
    private isPanelOpen = false;
    private touchStartX = 0;
    private touchStartY = 0;

    // Bound handlers for cleanup
    private readonly boundSyncActiveState: () => void;
    private readonly boundHandleSwipeStart: (e: TouchEvent) => void;
    private readonly boundHandleSwipeEnd: (e: TouchEvent) => void;

    constructor() {
        // Initialize elements
        this.elements = {
            tocWidget: document.querySelector(SELECTORS.TOC_WIDGET),
            sidebarContainer: null,
            mobileContainer: getElement(SELECTORS.MOBILE_CONTAINER),
            mobileContent: getElement(SELECTORS.MOBILE_CONTENT),
            mobileHeader: getElement<HTMLButtonElement>(SELECTORS.MOBILE_HEADER),
            fab: getElement<HTMLButtonElement>(SELECTORS.FAB),
            overlay: getElement(SELECTORS.OVERLAY),
            panel: getElement(SELECTORS.PANEL),
            panelContent: getElement(SELECTORS.PANEL_CONTENT),
            panelClose: getElement<HTMLButtonElement>(SELECTORS.PANEL_CLOSE),
        };

        // Bail if required elements missing
        if (!this.elements.tocWidget || !this.elements.mobileContainer || !this.elements.mobileContent) {
            return;
        }

        // Store original parent for moving back
        this.elements.sidebarContainer = this.elements.tocWidget.parentElement;

        // Create bound handlers for proper cleanup
        this.boundSyncActiveState = throttleRAF(() => this.syncActiveState());
        this.boundHandleSwipeStart = (e: TouchEvent) => this.handleSwipeStart(e);
        this.boundHandleSwipeEnd = (e: TouchEvent) => this.handleSwipeEnd(e);

        // Initialize
        this.setupMediaQuery();
        this.setupEventListeners();
    }

    private setupMediaQuery(): void {
        const mediaQuery = window.matchMedia(`(max-width: ${CONFIG.MOBILE_BREAKPOINT - 1}px)`);
        this.handleViewportChange(mediaQuery.matches);
        mediaQuery.addEventListener('change', (e) => this.handleViewportChange(e.matches));
    }

    private handleViewportChange(isMobile: boolean): void {
        if (isMobile) {
            this.activateMobileMode();
        } else {
            this.activateDesktopMode();
        }
    }

    private activateMobileMode(): void {
        const { tocWidget, mobileContent, panelContent } = this.elements;
        if (!tocWidget || !mobileContent) return;

        // Move TOC to mobile container
        mobileContent.appendChild(tocWidget);

        // Populate panel with cloned TOC
        if (panelContent) {
            this.populatePanel();
            window.addEventListener('scroll', this.boundSyncActiveState, { passive: true });
        }

        // Start collapsed
        this.setCollapsibleState(false);
    }

    private activateDesktopMode(): void {
        const { tocWidget, sidebarContainer } = this.elements;
        if (!tocWidget || !sidebarContainer) return;

        // Move TOC back to sidebar
        sidebarContainer.appendChild(tocWidget);

        // Cleanup
        window.removeEventListener('scroll', this.boundSyncActiveState);
        this.closePanel();
        this.setCollapsibleState(false);
    }

    private populatePanel(): void {
        const { panelContent, tocWidget } = this.elements;
        if (!panelContent || !tocWidget) return;

        const toc = tocWidget.querySelector(SELECTORS.TABLE_OF_CONTENTS);
        if (!toc) return;

        // Clone TOC without ID to avoid duplicates
        const clone = toc.cloneNode(true) as HTMLElement;
        clone.removeAttribute('id');
        clone.classList.add('toc-panel-clone');

        // Wrap to match desktop styling
        const wrapper = document.createElement('div');
        wrapper.className = 'toc-panel-wrapper';
        wrapper.appendChild(clone);

        panelContent.innerHTML = '';
        panelContent.appendChild(wrapper);

        this.syncActiveState();
    }

    private syncActiveState(): void {
        const { panelContent, tocWidget } = this.elements;
        if (!panelContent || !tocWidget) return;

        const originalToc = tocWidget.querySelector(SELECTORS.TABLE_OF_CONTENTS);
        const clonedToc = panelContent.querySelector(SELECTORS.PANEL_CLONE);
        if (!originalToc || !clonedToc) return;

        // Clear existing active states in clone
        clonedToc.querySelectorAll('li.active-class').forEach(el => {
            el.classList.remove('active-class');
        });

        // Copy active states from original
        originalToc.querySelectorAll('li.active-class').forEach(activeItem => {
            const href = activeItem.querySelector('a')?.getAttribute('href');
            if (href) {
                const cloneLink = clonedToc.querySelector(`a[href="${href}"]`);
                cloneLink?.parentElement?.classList.add('active-class');
            }
        });
    }

    private setupEventListeners(): void {
        const { mobileHeader, fab, panelClose, overlay, mobileContent, panelContent } = this.elements;

        // Collapsible toggle
        mobileHeader?.addEventListener('click', () => this.toggleCollapsible());

        // FAB opens panel
        fab?.addEventListener('click', () => this.openPanel());

        // Panel close button
        panelClose?.addEventListener('click', () => this.closePanel());

        // Overlay click closes panel
        overlay?.addEventListener('click', (e) => {
            if (e.target === overlay) this.closePanel();
        });

        // Escape key closes panel
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isPanelOpen) this.closePanel();
        });

        // Swipe gestures
        this.setupSwipeGestures();

        // TOC link clicks - collapsible
        mobileContent?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'A' && target.getAttribute('href')?.startsWith('#')) {
                setTimeout(() => this.setCollapsibleState(false), CONFIG.COLLAPSE_DELAY);
            }
        });

        // TOC link clicks - panel
        panelContent?.addEventListener('click', (e) => this.handlePanelLinkClick(e));
    }

    private handlePanelLinkClick(e: Event): void {
        const link = (e.target as HTMLElement).closest('a');
        const href = link?.getAttribute('href');

        if (href?.startsWith('#')) {
            e.preventDefault();
            this.closePanel();

            const targetElement = document.getElementById(href.slice(1));
            if (targetElement) {
                smoothScrollTo(targetElement);
            }
        }
    }

    private setupSwipeGestures(): void {
        const { overlay } = this.elements;
        if (!overlay) return;

        const swipeEnabled = overlay.dataset.swipeEnabled === 'true';
        if (!swipeEnabled) return;

        document.addEventListener('touchstart', this.boundHandleSwipeStart, { passive: true });
        document.addEventListener('touchend', this.boundHandleSwipeEnd, { passive: true });
    }

    private handleSwipeStart(e: TouchEvent): void {
        const touch = e.touches[0];
        this.touchStartX = touch.clientX;
        this.touchStartY = touch.clientY;
    }

    private handleSwipeEnd(e: TouchEvent): void {
        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - this.touchStartX;
        const deltaY = touch.clientY - this.touchStartY;

        // Only horizontal swipes that meet threshold
        if (Math.abs(deltaX) < Math.abs(deltaY)) return;
        if (Math.abs(deltaX) < CONFIG.SWIPE_THRESHOLD) return;

        if (this.isPanelOpen) {
            // Swipe right to close
            if (deltaX > 0) this.closePanel();
        } else {
            // Swipe left from right edge to open
            const fromRightEdge = this.touchStartX > window.innerWidth - CONFIG.EDGE_ZONE;
            if (deltaX < 0 && fromRightEdge) this.openPanel();
        }
    }

    private toggleCollapsible(): void {
        this.setCollapsibleState(!this.isCollapsibleExpanded);
    }

    private setCollapsibleState(expanded: boolean): void {
        const { mobileHeader, mobileContent } = this.elements;
        if (!mobileHeader || !mobileContent) return;

        this.isCollapsibleExpanded = expanded;
        mobileHeader.setAttribute('aria-expanded', String(expanded));
        mobileContent.setAttribute('aria-hidden', String(!expanded));
    }

    private openPanel(): void {
        const { overlay, panelClose } = this.elements;
        if (!overlay) return;

        this.isPanelOpen = true;
        overlay.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';

        setTimeout(() => panelClose?.focus(), CONFIG.FOCUS_DELAY);
    }

    private closePanel(): void {
        const { overlay, fab } = this.elements;
        if (!overlay) return;

        this.isPanelOpen = false;
        overlay.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';

        fab?.focus();
    }
}

function setupMobileTOC(): void {
    new MobileTOC();
}

export { setupMobileTOC };
