import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from "../firebase/firebaseConfig";
import { collection, onSnapshot } from "firebase/firestore";
import { useNavigate } from 'react-router-dom';
import styles from './Homepage.module.css'; // Import CSS module
import { useRef } from 'react';
import { useAuth } from '../components/AuthContext/AuthContext.jsx';
import { usePermissions } from '../hooks/usePermissions.js';
import { useTheme } from '../contexts/ThemeContext';
import useCurrentTerm from '../hooks/useCurrentTerm';
import { SSG_ID, FALLBACK_TERM, getSections } from '../components/orgUtils';
import CalendarWidget from '../components/CalendarWidget/CalendarWidget';
import {
  HiCurrencyDollar,
  HiFolder,
  HiSpeakerphone,
  HiCube,
  HiShoppingBag,
  HiCalendar,
  HiCog,
  HiUsers,
  HiTruck,
  HiLocationMarker,
  HiShoppingCart,
  HiDocumentText
} from 'react-icons/hi';
import {
  FiShoppingBag,
  FiTag,
  FiFilter,
  FiCheck,
  FiArrowRight,
  FiAlertCircle
} from 'react-icons/fi';

const OFFICER_FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1511367461989-f85a21fda167?w=400&h=400&fit=crop';

/* ── Icons (module scope so the carousel below can use them) ── */
const FacebookIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);
const ChevronLeftIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6"></polyline>
  </svg>
);
const ChevronRightIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"></polyline>
  </svg>
);

const ShoppingBagIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 01-8 0" />
  </svg>
);

// ── Bio / Statement Constraints for Carousel Cards (No Quotes, Word-Limited) ──
const MAX_STATEMENT_WORDS = 12; // Maximum words to keep card height perfectly uniform
const MAX_STATEMENT_CHARS = 80;  // Maximum character fallback

const formatOfficerStatement = (text) => {
  if (!text || !text.trim()) return 'Serving the CTU-Daanbantayan student body with integrity and purpose.';
  // Strip any existing straight or curly quote marks
  const clean = text.replace(/["“”'‘’`«»]/g, '').trim();
  const words = clean.split(/\s+/);
  if (words.length > MAX_STATEMENT_WORDS) {
    return `${words.slice(0, MAX_STATEMENT_WORDS).join(' ')}...`;
  }
  if (clean.length > MAX_STATEMENT_CHARS) {
    return `${clean.slice(0, MAX_STATEMENT_CHARS).trim()}...`;
  }
  return clean;
};

/* ───────────────────────────────────────────────
   OfficerCarousel — self-contained officer slider.
   Owns its slide index so several carousels can live
   on the page without fighting over shared state.
   ─────────────────────────────────────────────── */
function getCardsPerView() {
  if (typeof window === 'undefined') return 3;
  if (window.innerWidth <= 768) return 1;
  if (window.innerWidth <= 1024) return 2;
  return 3;
}

const OfficerCarousel = React.memo(function OfficerCarousel({ members }) {
  const [cardsPerView, setCardsPerView] = useState(getCardsPerView);
  const [slide, setSlide] = useState(0);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  useEffect(() => {
    let ticking = false;
    const handleResize = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const nextCards = getCardsPerView();
          setCardsPerView((prev) => (prev !== nextCards ? nextCards : prev));
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const totalSlides = Math.ceil(members.length / cardsPerView);

  // Keep the slide index valid when the list shrinks (org switch, term change).
  useEffect(() => {
    setSlide((prev) => (totalSlides > 0 && prev > totalSlides - 1 ? 0 : prev));
  }, [totalSlides]);

  const nextSlide = useCallback(() => setSlide((prev) => (prev + 1) % totalSlides), [totalSlides]);
  const prevSlide = useCallback(() => setSlide((prev) => (prev - 1 + totalSlides) % totalSlides), [totalSlides]);

  const handleTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchMove = (e) => { touchEndX.current = e.touches[0].clientX; };
  const handleTouchEnd = () => {
    const diff = touchStartX.current - touchEndX.current;
    if (diff > 50) nextSlide();
    else if (diff < -50) prevSlide();
  };

  if (members.length === 0) return null;

  return (
    <div className={styles.carouselWrapper}>
      {/* Top Slider Navigation & Progress Counter */}
      {totalSlides > 1 && (
        <div className={styles.carouselControlBar}>
          <div className={styles.carouselProgress}>
            <span className={styles.carouselCurrentSlide}>{String(slide + 1).padStart(2, '0')}</span>
            <span className={styles.carouselProgressDivider}>/</span>
            <span className={styles.carouselTotalSlides}>{String(totalSlides).padStart(2, '0')}</span>
          </div>
          <div className={styles.carouselArrowGroup}>
            <button
              className={`${styles.carouselArrow} ${styles.carouselArrowLeft}`}
              onClick={prevSlide}
              aria-label="Previous leadership slide"
              title="Previous slide"
            >
              <ChevronLeftIcon />
            </button>
            <button
              className={`${styles.carouselArrow} ${styles.carouselArrowRight}`}
              onClick={nextSlide}
              aria-label="Next leadership slide"
              title="Next slide"
            >
              <ChevronRightIcon />
            </button>
          </div>
        </div>
      )}

      <div className={styles.carouselContainer} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
        <div className={styles.carouselTrack}>
          <div
            className={styles.carouselSlides}
            style={{ transform: `translateX(-${slide * 100}%)`, transition: 'transform 0.55s cubic-bezier(0.16, 1, 0.3, 1)' }}
          >
            {Array.from({ length: totalSlides }).map((_, slideIndex) => {
              const slideMembers = members.slice(slideIndex * cardsPerView, (slideIndex + 1) * cardsPerView);

              return (
                <div key={slideIndex} className={styles.carouselSlide}>
                  <div className={styles.officersGrid}>
                    {slideMembers.map((officer) => (
                      <article
                        key={officer.docId}
                        className={styles.officerCard}
                      >
                        {/* Status / Role Header */}
                        <div className={styles.officerCardHeader}>
                          <span className={styles.officerPositionBadge}>{officer.position}</span>
                        </div>

                        {/* Portrait Frame */}
                        <div className={styles.officerImageWrapper}>
                          <img
                            src={officer.image64 || OFFICER_FALLBACK_IMAGE}
                            alt={officer.name}
                            className={styles.officerImage}
                            onError={(e) => { e.target.src = OFFICER_FALLBACK_IMAGE; }}
                            loading="lazy"
                          />
                          <div className={styles.officerImageRing} />
                        </div>

                        {/* Officer Info */}
                        <div className={styles.officerBody}>
                          <h3 className={styles.officerName}>{officer.name}</h3>
                          <div className={styles.officerQuoteDivider} />
                          <p
                            className={`${styles.officerDescription} ${!officer.description ? styles.officerDescriptionPlaceholder : ''}`}
                            title={officer.description || 'Dedicated SSG Leader'}
                          >
                            {formatOfficerStatement(officer.description)}
                          </p>
                        </div>

                        {/* Footer & Social Contacts */}
                        <div className={styles.officerFooter}>
                          {officer.facebookLink ? (
                            <a
                              href={officer.facebookLink}
                              className={styles.socialLink}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`${officer.name} on Facebook`}
                              title="Official Facebook Profile"
                            >
                              <FacebookIcon />
                              <span className={styles.socialLabel}>Connect</span>
                            </a>
                          ) : (
                            <span className={styles.officerBadgeMuted}>CTU SSG Leader</span>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {totalSlides > 1 && (
        <div className={styles.carouselDots} role="tablist" aria-label="Slider Pagination">
          {Array.from({ length: totalSlides }).map((_, index) => (
            <button
              key={index}
              role="tab"
              aria-selected={slide === index}
              className={`${styles.carouselDot} ${slide === index ? styles.carouselDotActive : ''}`}
              onClick={() => setSlide(index)}
              aria-label={`Jump to leadership page ${index + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
});

function Homepage({ toggleSidebar, sidebarOpen }) {
  const { userRole, currentUser } = useAuth();
  const permissions = usePermissions();
  const { theme } = useTheme();
  const isClassic = theme === 'dark';
  const { currentTerm } = useCurrentTerm();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [productCategoryFilter, setProductCategoryFilter] = useState('ALL');
  const [officers, setOfficers] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const navigate = useNavigate();
  const [expandedID, setExpandedId] = useState(null);

  // Organizations for the dynamic "Meet The ... Officers" section (SSG excluded)
  const [orgs, setOrgs] = useState([]);
  const [activeOrgId, setActiveOrgId] = useState(null);

  // News articles state
  const [newsArticles, setNewsArticles] = useState([]);
  const [newsSlideIndex, setNewsSlideIndex] = useState(0);
  const [newsImageIndex, setNewsImageIndex] = useState(0);

  // Scroll-to-top visibility
  const [showScrollTop, setShowScrollTop] = useState(false);
  const showScrollTopRef = useRef(false);

  // Refs for scrolling to sections and viewport-aware pauses
  const productsRef = useRef(null);
  const announcementsRef = useRef(null);
  const calendarRef = useRef(null);
  const heroSectionRef = useRef(null);
  const newsSectionRef = useRef(null);
  const [isHeroVisible, setIsHeroVisible] = useState(true);
  const [isNewsVisible, setIsNewsVisible] = useState(true);

  // Hero text animation state
  const [heroTextIndex, setHeroTextIndex] = useState(0);
  const [isHeroFading, setIsHeroFading] = useState(false);

  const heroTexts = [
    { text: 'SUPREMO\nGOBYERNO', duration: 10000 }, // 10 seconds
    { text: 'FOR THE\nSERVICE', duration: 5000 },   // 5 seconds
    { text: 'FOR THE\nSTUDENTS', duration: 5000 }   // 5 seconds
  ];

  /* ── Firebase: Products ── */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "products"), (snap) => {
      setProducts(snap.docs.map((d) => ({ productId: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  /* ── Distinct Product Categories & Filtered List ── */
  const productCategories = useMemo(() => {
    const set = new Set();
    products.forEach((p) => {
      if (p.category && p.category.trim()) {
        set.add(p.category.trim());
      }
    });
    return Array.from(set);
  }, [products]);

  const filteredProducts = useMemo(() => {
    if (productCategoryFilter === 'ALL') return products;
    if (productCategoryFilter === 'LOW_STOCK') {
      return products.filter((p) => (p.stockAvailable || 0) <= 10 && (p.stockAvailable || 0) > 0);
    }
    if (productCategoryFilter === 'IN_STOCK') {
      return products.filter((p) => (p.stockAvailable || 0) > 0);
    }
    return products.filter((p) => (p.category || 'General').toLowerCase() === productCategoryFilter.toLowerCase());
  }, [products, productCategoryFilter]);

  /* ── Firebase: Officers ── */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "members"), (snap) => {
      setOfficers(snap.docs.map((d) => ({ docId: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  /* ── Officers of the current term only (position-ranked) ── */
  const rankedOfficers = useMemo(() => {
    const order = {
      "President": 1, "Vice President": 2, "Secretary": 3, "Treasurer": 4,
      "COTE Governor": 5, "COED Governor": 6, "Senator": 7,
      "Multimedia Director": 8, "Multimedia": 9, "Activity Officer": 10,
      "BSHM Representative": 11, "BSIT Representative": 12,
      "BSFI Representative": 13, "BEED MATH Representative": 14,
      "BSED Representative": 15, "BIT Representative": 16, "BSIE Representative": 17,
    };
    const positions = Object.keys(order);

    return officers
      .filter((m) => {
        // Only SSG officers — members without orgId are legacy SSG records.
        if ((m.orgId || SSG_ID) !== SSG_ID) return false;
        if (!positions.includes(m.position)) return false;
        // Members saved before terms were selectable belong to the fallback term.
        return (m.term || FALLBACK_TERM) === currentTerm;
      })
      .sort((a, b) => (order[a.position] || 999) - (order[b.position] || 999));
  }, [officers, currentTerm]);

  /* ── Firebase: Organizations ── */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "organizations"), (snap) => {
      setOrgs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  /* ── Organizations eligible for this section.
     SSG is deliberately excluded: the "Meet Our Officers" section above
     already covers it, so listing it here would just duplicate. ── */
  const orgList = useMemo(() => orgs.filter((o) => o.id !== SSG_ID), [orgs]);

  // Keep the selection valid as orgs load or get removed.
  useEffect(() => {
    setActiveOrgId((prev) => (prev && orgList.some((o) => o.id === prev) ? prev : orgList[0]?.id || null));
  }, [orgList]);

  const activeOrg = useMemo(
    () => orgList.find((o) => o.id === activeOrgId) || orgList[0] || null,
    [orgList, activeOrgId]
  );

  /* ── Officers of the selected org, in that org's own chart order ── */
  const orgRankedOfficers = useMemo(() => {
    if (!activeOrg) return [];

    // Rank positions from the org's hierarchy chart (term-aware), falling
    // back to the org's default template when a term has no chart yet.
    const rank = new Map();
    getSections(activeOrg, currentTerm).forEach((section) => {
      (section.positions || []).forEach((p) => {
        const key = (p.title || '').trim().toLowerCase();
        if (key && !rank.has(key)) rank.set(key, rank.size);
      });
    });

    return officers
      .filter((m) => {
        // Members with no orgId are legacy SSG records
        if ((m.orgId || SSG_ID) !== activeOrg.id) return false;
        // Members saved before terms were selectable belong to the fallback term
        return (m.term || FALLBACK_TERM) === currentTerm;
      })
      .sort((a, b) => {
        const ra = rank.get((a.position || '').trim().toLowerCase()) ?? rank.size;
        const rb = rank.get((b.position || '').trim().toLowerCase()) ?? rank.size;
        if (ra !== rb) return ra - rb;
        return (a.name || '').localeCompare(b.name || '');
      });
  }, [officers, activeOrg, currentTerm]);

  /* ── Firebase: Announcements ── */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "announcements"), (snap) => {
      // Only announcements explicitly released to the homepage are shown.
      // Missing field = released, so announcements created before this
      // option existed stay live.
      setAnnouncements(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((a) => a.homepageVisible !== false)
      );
    });
    return () => unsub();
  }, []);

  /* ── Firebase: News Articles ── */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "newsArticles"), (snap) => {
      const allNews = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // Filter out expired articles
      const activeNews = allNews.filter((article) => {
        if (!article.expiryDate) return true;
        return new Date(article.expiryDate) > new Date();
      });
      activeNews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setNewsArticles(activeNews);
    });
    return () => unsub();
  }, []);

  /* ── Viewport Observers for Hero & News to pause off-screen timers ── */
  useEffect(() => {
    if (!window.IntersectionObserver) return;
    const heroObserver = new IntersectionObserver(
      ([entry]) => setIsHeroVisible(entry.isIntersecting),
      { threshold: 0.1 }
    );
    const heroEl = heroSectionRef.current;
    if (heroEl) heroObserver.observe(heroEl);

    const newsObserver = new IntersectionObserver(
      ([entry]) => setIsNewsVisible(entry.isIntersecting),
      { threshold: 0.1 }
    );
    const newsEl = newsSectionRef.current;
    if (newsEl) newsObserver.observe(newsEl);

    return () => {
      if (heroEl) heroObserver.unobserve(heroEl);
      if (newsEl) newsObserver.unobserve(newsEl);
    };
  }, [newsArticles.length]);

  /* ── Hero Text Animation (pauses when hero is scrolled off-screen) ── */
  useEffect(() => {
    if (!isHeroVisible) return;
    const currentText = heroTexts[heroTextIndex];

    // Start fade out 500ms before switching
    const fadeOutTimer = setTimeout(() => {
      setIsHeroFading(true);
    }, currentText.duration - 500);

    // Switch to next text
    const switchTimer = setTimeout(() => {
      setHeroTextIndex((prev) => (prev + 1) % heroTexts.length);
      setIsHeroFading(false);
    }, currentText.duration);

    return () => {
      clearTimeout(fadeOutTimer);
      clearTimeout(switchTimer);
    };
  }, [heroTextIndex, isHeroVisible]);

  /* ── Scroll-to-top visibility (eliminated redundant state dispatches) ── */
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const isScrolled = window.scrollY > 600;
          if (showScrollTopRef.current !== isScrolled) {
            showScrollTopRef.current = isScrolled;
            setShowScrollTop(isScrolled);
          }
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* ── News Slideshow: Auto-advance articles (pauses when off-screen) ── */
  useEffect(() => {
    if (newsArticles.length === 0 || !isNewsVisible) return;
    const interval = setInterval(() => {
      setNewsSlideIndex((prev) => (prev + 1) % newsArticles.length);
      setNewsImageIndex(0);
    }, 6000);
    return () => clearInterval(interval);
  }, [newsArticles.length, isNewsVisible]);

  /* ── News Slideshow: Auto-advance images within article ── */
  useEffect(() => {
    if (newsArticles.length === 0 || !isNewsVisible) return;
    const currentArticle = newsArticles[newsSlideIndex];
    if (!currentArticle?.images || currentArticle.images.length <= 1) return;
    const interval = setInterval(() => {
      setNewsImageIndex((prev) => (prev + 1) % currentArticle.images.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [newsSlideIndex, newsArticles, isNewsVisible]);

  /* ── Helpers ── */
  const handleOrderNow = (product) => navigate('/order', { state: { product } });

  const scrollToSection = (ref) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const formatDate = (ds) => {
    if (!ds) return 'Date TBA';
    return new Date(ds).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  const getCategoryLabel = (cat) => (cat || 'General').toUpperCase();

  /* ─────────────────────────────────────────── */
  return (
    <div className={`${styles.pageWrapper} ${isClassic ? `${styles.pageWrapperClassic} pageWrapperClassic` : ''}`}>

      {/* Guest notice — only while browsing without an account */}
      {!currentUser && (
        <div className={styles.guestBanner}>
          <span>You are browsing as a guest. Sign in to place orders and access member features.</span>
          <button type="button" className={styles.guestBannerBtn} onClick={() => navigate('/login')}>
            Sign In
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════
          HERO — editorial masthead
      ══════════════════════════════════════ */}
      <section ref={heroSectionRef} className={`${styles.heroSection} ${isClassic ? styles.heroSectionClassic : ''}`}>
        {/* Top Decorative Tribal Band (Classic Theme Only) */}
        {isClassic && <div className={styles.tribalBorderTop} aria-hidden="true" />}

        {/* Slideshow background */}
        <div className={styles.slideContainer}>
          {[(isClassic ? 'slideHero' : 'slide1'), 'slide1', 'slide2', 'slide3', 'slide4', 'slide5', 'slide6'].map((s, idx) => (
            <div key={`${s}-${idx}`} className={`${styles.slide} ${styles[s]}`}></div>
          ))}
        </div>
        <div className={styles.heroOverlay}></div>
        {/* Diagonal texture */}
        {isClassic && <div className={styles.diagonalTexture}></div>}

        <div className={styles.heroContentWrapper}>
          <div className={styles.heroContent}>
            {/* Eyebrow row */}
            {isClassic ? (
              <div className={styles.heroEyebrowRow}>
                <span className={styles.eyebrowLine} />
                <span className={styles.eyebrowDiamond}>◆</span>
                <span className={styles.heroEyebrow}>OFFICIAL STUDENT GOVERNMENT PLATFORM</span>
                <span className={styles.eyebrowDiamond}>◆</span>
                <span className={styles.eyebrowLine} />
              </div>
            ) : (
              <span className={styles.heroEyebrow}>Official Student Government Platform</span>
            )}

            <h1 className={`${styles.heroTitle} ${isHeroFading ? styles.heroTitleFadeOut : styles.heroTitleFadeIn}`}>
              {heroTexts[heroTextIndex].text.split('\n').map((line, i) => (
                <span
                  key={i}
                  className={isClassic ? (i === 0 ? styles.heroTitleWhite : styles.heroTitleGold) : undefined}
                >
                  {line}
                  {i < heroTexts[heroTextIndex].text.split('\n').length - 1 && <br />}
                </span>
              ))}
            </h1>

            <p className={styles.heroDescription}>
              Centralizing Student Government for a Connected Future.
              <br />
              Track, engage, and plan university events with unprecedented efficiency.
            </p>

            <button
              type="button"
              className={styles.exploreButton}
              onClick={() => scrollToSection(productsRef)}
              aria-label="Explore student services and catalogue"
            >
              <span>EXPLORE SERVICES</span>
              <FiArrowRight className={styles.exploreArrow} />
            </button>
          </div>

          {/* Quick Access Card */}
          <div className={`${styles.quickAccessCard} ${isClassic ? styles.quickAccessCardClassic : ''}`}>
            {isClassic && <div className={styles.quickAccessTribalStrip} aria-hidden="true" />}
            <div className={styles.quickAccessBody}>
              <p className={styles.quickAccessEyebrow}>QUICK ACCESS</p>
              <div className={styles.quickAccessList}>
                {(() => {
                  const getDynamicQuickAccessItems = () => {
                    const items = [];

                    // 1. Admin & User Management (for users with admin/user management privileges or overrides)
                    if (permissions.checkPermission('canManageUsers') || permissions.checkRole('admin') || permissions.checkRole('president')) {
                      items.push({ icon: <HiCog />, label: 'Admin Dashboard', action: () => navigate('/admin') });
                      items.push({ icon: <HiUsers />, label: 'User Management', action: () => navigate('/admin/users') });
                    }

                    // 2. Finance (for users with finance viewing/editing permission)
                    if (permissions.checkPermission('canViewFinance')) {
                      items.push({ icon: <HiCurrencyDollar />, label: 'Finances', action: () => navigate('/finance') });
                    }

                    // 3. Documents (for secretariat, legislative, officers or users with canExportData)
                    if (permissions.checkPermission('canExportData')) {
                      items.push({ icon: <HiFolder />, label: 'Documents', action: () => navigate('/documents') });
                    }

                    // 4. Inventory (for users with canManageProducts)
                    if (permissions.checkPermission('canManageProducts')) {
                      items.push({ icon: <HiCube />, label: 'Inventory', action: () => navigate('/inventory') });
                    }

                    // 5. Announcements (for users with canSendNotifications or Creatives)
                    if (permissions.checkPermission('canSendNotifications') || permissions.checkPermission('canManageCreatives')) {
                      items.push({ icon: <HiSpeakerphone />, label: 'Announcements', action: () => navigate('/announcement') });
                    }

                    // 6. Commerce Hub (management for officers with canManageOrders or /commerce access)
                    if (permissions.checkPermission('canManageOrders') || permissions.checkRouteAccess('/commerce')) {
                      items.push({ icon: <HiShoppingBag />, label: 'Commerce Hub', action: () => navigate('/commerce') });
                    }

                    // 7. Sections & Contributions / Roster
                    if (permissions.checkPermission('canSubmitRoster') || permissions.checkRouteAccess('/sections-contributions')) {
                      items.push({ icon: <HiDocumentText />, label: 'Sections & Rosters', action: () => navigate('/sections-contributions') });
                    }

                    // 8. Order Placement (student/member requisition)
                    items.push({ icon: <HiShoppingCart />, label: 'Order Placement', action: () => navigate('/order') });

                    // 9. Interactive Campus Sky Map (open to all students and members)
                    items.push({ icon: <HiLocationMarker />, label: 'Campus Map', action: () => navigate('/campus-map') });

                    // 10. Event Calendar
                    items.push({ icon: <HiCalendar />, label: 'Event Calendar', action: () => scrollToSection(calendarRef) });

                    // Deduplicate by label and take top 3 most relevant for the user
                    const uniqueItems = [];
                    const seen = new Set();
                    for (const item of items) {
                      if (!seen.has(item.label)) {
                        seen.add(item.label);
                        uniqueItems.push(item);
                      }
                      if (uniqueItems.length === 3) break;
                    }

                    return uniqueItems;
                  };

                  return getDynamicQuickAccessItems().map(({ icon, label, action }) => (
                    <button
                      key={label}
                      type="button"
                      className={styles.quickAccessRow}
                      onClick={action}
                    >
                      <span className={styles.quickAccessIconWrap}>{icon}</span>
                      <span className={styles.quickAccessLabel}>{label}</span>
                    </button>
                  ));
                })()}
              </div>
            </div>
          </div>
        </div>

        {/* Hero Bottom Ticker Bar (Classic Theme Only) */}
        {isClassic && (
          <div className={styles.heroBottomTicker}>
            <span>STUDENT VOICE</span>
            <span className={styles.tickerDiamond}>✦</span>
            <span>STRONGER COMMUNITY</span>
            <span className={styles.tickerDiamond}>✦</span>
            <span>BRIGHTER FUTURE</span>
          </div>
        )}

        {/* Bottom Decorative Tribal Band (Classic Theme Only) */}
        {isClassic && <div className={styles.tribalBorderBottom} aria-hidden="true" />}
      </section>

      <hr className={styles.sectionRule} />

      {/* ══════════════════════════════════════
          PRODUCTS
      ══════════════════════════════════════ */}
      {/* ══════════════════════════════════════
          PRODUCTS CATALOGUE — Redesigned
      ══════════════════════════════════════ */}
      <section ref={productsRef} className={styles.productsSection} aria-label="Official Merchandise Catalogue">
        <header className={styles.sectionHeader}>
          <span className={styles.sectionEyebrow}>OFFICIAL MERCHANDISE</span>
          <h2 className={styles.sectionTitle}>Product Catalogue</h2>
          <p className={styles.sectionSubtitle}>
            Official university lanyards, uniform sets, and student body essentials
          </p>

          {/* Interactive Category & Stock Filter Controls */}
          {!loading && products.length > 0 && (
            <div className={styles.productFilterBar} role="tablist" aria-label="Filter products">
              <button
                type="button"
                role="tab"
                aria-selected={productCategoryFilter === 'ALL'}
                className={`${styles.productFilterBtn} ${productCategoryFilter === 'ALL' ? styles.productFilterBtnActive : ''}`}
                onClick={() => setProductCategoryFilter('ALL')}
              >
                All Items <span className={styles.productFilterCount}>{products.length}</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={productCategoryFilter === 'IN_STOCK'}
                className={`${styles.productFilterBtn} ${productCategoryFilter === 'IN_STOCK' ? styles.productFilterBtnActive : ''}`}
                onClick={() => setProductCategoryFilter('IN_STOCK')}
              >
                In Stock <span className={styles.productFilterCount}>{products.filter(p => (p.stockAvailable || 0) > 0).length}</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={productCategoryFilter === 'LOW_STOCK'}
                className={`${styles.productFilterBtn} ${productCategoryFilter === 'LOW_STOCK' ? styles.productFilterBtnActive : ''}`}
                onClick={() => setProductCategoryFilter('LOW_STOCK')}
              >
                Low Stock <span className={styles.productFilterCount}>{products.filter(p => (p.stockAvailable || 0) <= 10 && (p.stockAvailable || 0) > 0).length}</span>
              </button>

              {productCategories.map((cat) => {
                const count = products.filter(p => (p.category || '').toLowerCase() === cat.toLowerCase()).length;
                return (
                  <button
                    key={cat}
                    type="button"
                    role="tab"
                    aria-selected={productCategoryFilter.toLowerCase() === cat.toLowerCase()}
                    className={`${styles.productFilterBtn} ${productCategoryFilter.toLowerCase() === cat.toLowerCase() ? styles.productFilterBtnActive : ''}`}
                    onClick={() => setProductCategoryFilter(cat)}
                  >
                    {cat} <span className={styles.productFilterCount}>{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </header>

        {loading ? (
          <div className={styles.skeletonGrid}>
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className={styles.skeletonCard}>
                <div className={styles.skeletonImage} />
                <div className={styles.skeletonBody}>
                  <div className={styles.skeletonLine} style={{ width: '30%' }} />
                  <div className={styles.skeletonLine} style={{ width: '85%' }} />
                  <div className={styles.skeletonLine} style={{ width: '65%' }} />
                  <div className={styles.skeletonLine} style={{ width: '100%', marginTop: 'auto' }} />
                </div>
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className={styles.emptyProductsState}>
            <FiShoppingBag className={styles.emptyProductsIcon} />
            <h3 className={styles.emptyProductsTitle}>Catalogue Currently Empty</h3>
            <p className={styles.emptyProductsText}>
              No student merchandise items are currently listed. Please check back soon or consult the SSG Supply Office.
            </p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className={styles.emptyProductsState}>
            <FiFilter className={styles.emptyProductsIcon} />
            <h3 className={styles.emptyProductsTitle}>No Matching Items</h3>
            <p className={styles.emptyProductsText}>
              No items found matching the selected filter. Try selecting "All Items" to see the complete catalogue.
            </p>
            <button
              type="button"
              className={styles.resetFilterBtn}
              onClick={() => setProductCategoryFilter('ALL')}
            >
              Show All Products
            </button>
          </div>
        ) : (
          <div className={styles.productsGrid}>
            {filteredProducts.map((product) => {
              const inStock = (product.stockAvailable || 0) > 0;
              const isLowStock = inStock && product.stockAvailable <= 10;
              const isOutOfStock = !inStock;

              return (
                <article key={product.productId} className={styles.productCard}>
                  {/* Image Display Surface */}
                  <div className={styles.productImageWrapper}>
                    <img
                      src={product.imageBase64 || product.imageUrl || 'https://images.unsplash.com/photo-1434494878577-86c23bcb06b9?w=600&h=600&fit=crop'}
                      alt={product.productName}
                      className={styles.productImage}
                      onError={(e) => { e.target.src = 'https://images.unsplash.com/photo-1434494878577-86c23bcb06b9?w=600&h=600&fit=crop'; }}
                      loading="lazy"
                    />

                    {/* Status Pill Badges */}
                    <div className={styles.productBadgeContainer}>
                      {isLowStock && (
                        <span className={styles.badgeLow}>
                          <FiAlertCircle className={styles.badgeIcon} /> Low Stock ({product.stockAvailable})
                        </span>
                      )}
                      {isOutOfStock && (
                        <span className={styles.badgeOut}>
                          Out of Stock
                        </span>
                      )}
                      {inStock && !isLowStock && (
                        <span className={styles.badgeAvailable}>
                          Available
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card Content & Specifications */}
                  <div className={styles.productInfo}>
                    <div className={styles.productMetaHeader}>
                      <span className={styles.productCategoryLabel}>
                        {product.category || 'MERCHANDISE'}
                      </span>
                      <span className={`${styles.stockIndicator} ${isOutOfStock ? styles.stockOut : isLowStock ? styles.stockLow : styles.stockGood}`}>
                        <span className={styles.stockDot} />
                        {product.stockAvailable || 0} left
                      </span>
                    </div>

                    <h3 className={styles.productName} title={product.productName}>
                      {product.productName}
                    </h3>

                    {product.description ? (
                      <p className={styles.productDescription} title={product.description}>
                        {product.description}
                      </p>
                    ) : (
                      <p className={`${styles.productDescription} ${styles.productDescriptionPlaceholder}`}>
                        Official student government merchandise certified for CTU campus operations.
                      </p>
                    )}

                    {/* Technical Variants Specification */}
                    <div className={styles.productVariantsBlock}>
                      {product.sizeOptions?.length > 0 && (
                        <div className={styles.tagRow}>
                          <span className={styles.tagRowLabel}>SIZES</span>
                          <div className={styles.tagList}>
                            {product.sizeOptions.map((s, i) => (
                              <span key={i} className={styles.tag}>{s}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {product.colorVariations?.length > 0 && (
                        <div className={styles.tagRow}>
                          <span className={styles.tagRowLabel}>COLORS</span>
                          <div className={styles.tagList}>
                            {product.colorVariations.map((c, i) => (
                              <span key={i} className={styles.tag}>{c}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Bottom Pricing & Action Surface */}
                    <div className={styles.productCardFooter}>
                      <div className={styles.priceContainer}>
                        <span className={styles.priceCurrency}>₱</span>
                        <span className={styles.priceValue}>{product.price?.toFixed(2) || '0.00'}</span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleOrderNow(product)}
                        disabled={isOutOfStock}
                        className={`${styles.orderButton} ${isOutOfStock ? styles.orderButtonDisabled : ''}`}
                        aria-label={`Order ${product.productName}`}
                      >
                        <FiShoppingBag className={styles.orderButtonIcon} />
                        <span>{isOutOfStock ? 'Depleted' : 'Order Now'}</span>
                        {!isOutOfStock && <FiArrowRight className={styles.orderArrowIcon} />}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <hr className={styles.sectionRule} />

      {/* ══════════════════════════════════════
          WHAT'S NEW — News Slideshow
      ══════════════════════════════════════ */}
      {newsArticles.length > 0 && (
        <section ref={newsSectionRef} className={styles.whatsNewSection}>
          <header className={styles.sectionHeader}>
            <span className={styles.sectionEyebrow}>WHAT'S NEW</span>
            <h2 className={styles.sectionTitle}>Latest News</h2>
            <p className={styles.sectionSubtitle}>Stay informed with the latest updates and stories</p>
          </header>

          <div className={styles.newsSlideshow}>
            {/* Slides */}
            {newsArticles.map((article, idx) => (
              <div
                key={article.id}
                className={`${styles.newsSlide} ${idx === newsSlideIndex ? styles.newsSlideActive : ''}`}
              >
                {/* Image background carousel */}
                <div className={styles.newsSlideImageWrapper}>
                  {article.images?.map((img, imgIdx) => (
                    <img
                      key={imgIdx}
                      src={img}
                      alt={`${article.title} photo ${imgIdx + 1}`}
                      className={`${styles.newsSlideImage} ${idx === newsSlideIndex && imgIdx === newsImageIndex ? styles.newsSlideImageActive : ''}`}
                    />
                  ))}
                  <div className={styles.newsSlideOverlay}></div>
                </div>

                {/* Content overlay */}
                <div className={styles.newsSlideContent}>
                  <span className={`${styles.newsSlideTag} ${styles[`newsTag${article.tag?.charAt(0).toUpperCase()}${article.tag?.slice(1)}`]}`}>
                    {article.tag?.toUpperCase()}
                  </span>
                  <h3 className={styles.newsSlideTitle}>{article.title}</h3>
                  <p className={styles.newsSlideDescription}>{article.description}</p>
                  {article.images?.length > 1 && (
                    <div className={styles.newsImageDots}>
                      {article.images.map((_, dotIdx) => (
                        <span
                          key={dotIdx}
                          className={`${styles.newsImageDot} ${idx === newsSlideIndex && dotIdx === newsImageIndex ? styles.newsImageDotActive : ''}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Article navigation dots */}
            {newsArticles.length > 1 && (
              <div className={styles.newsSlideDots}>
                {newsArticles.map((_, idx) => (
                  <button
                    key={idx}
                    className={`${styles.newsSlideDot} ${idx === newsSlideIndex ? styles.newsSlideDotActive : ''}`}
                    onClick={() => { setNewsSlideIndex(idx); setNewsImageIndex(0); }}
                    aria-label={`Go to news ${idx + 1}`}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <hr className={styles.sectionRule} />

      {/* ══════════════════════════════════════
          ANNOUNCEMENTS — editorial news grid
      ══════════════════════════════════════ */}
      <section ref={announcementsRef} className={styles.announcementsSection}>
        <header className={styles.sectionHeader}>
          <span className={styles.sectionEyebrow}>BULLETIN</span>
          <h2 className={styles.sectionTitle}>Latest Announcements</h2>
          <p className={styles.sectionSubtitle}>Stay updated with recent events and activities</p>
        </header>

        {announcements.length === 0 ? (
          <p className={styles.stateText}>No announcements at the moment.</p>
        ) : (
          <div className={styles.announcementsGrid}>
            {/* Featured — first item large */}
            {announcements[0] && (
              <article
                className={`${styles.announcementCard} ${styles.announcementFeatured}`}
                onClick={() => setExpandedId(expandedID === announcements[0].id ? null : announcements[0].id)}
              >
                {announcements[0].imageBase64 && (
                  <div className={styles.announcementFeaturedImage}>
                    <img
                      src={announcements[0].imageBase64}
                      alt={announcements[0].title}
                      className={styles.announcementImage}
                      onError={(e) => { e.target.src = '/AnnouncementPic/default.jpg'; }}
                    />
                    <div className={styles.announcementImageOverlay}></div>
                  </div>
                )}
                <div className={styles.announcementCardBody}>
                  <span className={styles.announcementCategory}>{getCategoryLabel(announcements[0].category)}</span>
                  <h3 className={styles.announcementTitle}>{announcements[0].title}</h3>
                  <p className={styles.announcementDateLine}>
                    <em>{formatDate(announcements[0].eventDate)}{announcements[0].eventTime ? ` · ${announcements[0].eventTime}` : ''}</em>
                  </p>
                  <div className={styles.announcementToggle}>
                    <span>{expandedID === announcements[0].id ? '−' : '+'}</span>
                    <span>{expandedID === announcements[0].id ? 'Collapse' : 'Read More'}</span>
                  </div>
                  {expandedID === announcements[0].id && (
                    <div className={styles.announcementExpanded}>
                      {announcements[0].description && (
                        <p className={styles.announcementExpandedDesc}>{announcements[0].description}</p>
                      )}
                      {announcements[0].venue && (
                        <p className={styles.announcementVenue}>📍 {announcements[0].venue}</p>
                      )}
                    </div>
                  )}
                </div>
              </article>
            )}

            {/* Remaining items — modular list cards */}
            <div className={styles.announcementList}>
              {announcements.slice(1).map((ann) => (
                <article
                  key={ann.id}
                  className={`${styles.announcementListItem} ${expandedID === ann.id ? styles.announcementListItemExpanded : ''}`}
                >
                  <div
                    className={styles.announcementItemHeader}
                    onClick={() => setExpandedId(expandedID === ann.id ? null : ann.id)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={expandedID === ann.id}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setExpandedId(expandedID === ann.id ? null : ann.id);
                      }
                    }}
                  >
                    <div className={styles.announcementListLeft}>
                      {ann.imageBase64 && (
                        <div className={styles.announcementListThumb}>
                          <img
                            src={ann.imageBase64}
                            alt={ann.title}
                            onError={(e) => { e.target.src = '/AnnouncementPic/default.jpg'; }}
                          />
                        </div>
                      )}
                      <div className={styles.announcementListMeta}>
                        <span className={styles.announcementCategory}>{getCategoryLabel(ann.category)}</span>
                        <h4 className={styles.announcementListTitle}>{ann.title}</h4>
                        <p className={styles.announcementDateLine}>
                          <em>{formatDate(ann.eventDate)}{ann.eventTime ? ` · ${ann.eventTime}` : ''}</em>
                        </p>
                      </div>
                    </div>
                    <div className={styles.announcementListToggle} aria-label="Toggle details">
                      <span>{expandedID === ann.id ? '−' : '+'}</span>
                    </div>
                  </div>

                  {expandedID === ann.id && (
                    <div className={styles.announcementExpanded}>
                      {ann.description && <p className={styles.announcementExpandedDesc}>{ann.description}</p>}
                      {ann.venue && <p className={styles.announcementVenue}>📍 {ann.venue}</p>}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
        )}

        {announcements.length > 0 && (
          <div className={styles.announcementsFooterAction}>
            <button
              type="button"
              className={styles.viewAllAnnouncementsBtn}
              onClick={() => navigate('/announcement')}
              aria-label="View all campus announcements and bulletins"
            >
              <span>VIEW COMPLETE BULLETIN ARCHIVE</span>
              <FiArrowRight className={styles.archiveArrow} />
            </button>
          </div>
        )}
      </section>

      <hr className={styles.sectionRule} />

      {/* ══════════════════════════════════════
          EVENT CALENDAR — Preview Widget (Read-Only)
      ══════════════════════════════════════ */}
      <section ref={calendarRef} className={styles.calendarSection}>
        <header className={styles.sectionHeader}>
          <span className={styles.sectionEyebrow}>ACADEMIC & ACTIVITIES CALENDAR</span>
          <h2 className={styles.sectionTitle}>Upcoming Events & Schedules</h2>
          <p className={styles.sectionSubtitle}>
            Official institutional calendar, deadlines, departmental events, and student assemblies
          </p>
        </header>

        <div className={styles.calendarWrapper}>
          <CalendarWidget readOnly={true} isClassicHomepage={isClassic} />
        </div>
      </section>

      <hr className={styles.sectionRule} />

      {/* ══════════════════════════════════════
          OFFICERS — Carousel
      ══════════════════════════════════════ */}
      {rankedOfficers.length > 0 && (
        <section className={styles.officersSection}>
          <header className={styles.sectionHeader}>
            <span className={styles.sectionEyebrow}>LEADERSHIP</span>
            <h2 className={styles.sectionTitle}>Meet Our Officers</h2>
            {currentTerm && (
              <span className={styles.officersTermBadge}>Term {currentTerm}</span>
            )}
            <p className={styles.sectionSubtitle}>
              Dedicated leaders committed to serving our student community
            </p>
          </header>

          <OfficerCarousel members={rankedOfficers} />
        </section>
      )}

      <hr className={styles.sectionRule} />

      {/* ══════════════════════════════════════
          ORGANIZATION OFFICERS — switchable org carousel
      ══════════════════════════════════════ */}
      {orgList.length === 0 ? (
        /* ── Nothing to switch between yet ── */
        <section className={styles.officersSection}>
          <header className={styles.sectionHeader}>
            <span className={styles.sectionEyebrow}>ORGANIZATION</span>
            <h2 className={styles.sectionTitle}>Meet The Organization Officers</h2>
          </header>
          <p className={styles.orgEmptyNotice}>NO ORGANIZATION ADDED YET</p>
        </section>
      ) : (
        <section className={styles.officersSection}>
          <header className={styles.sectionHeader}>
            <span className={styles.sectionEyebrow}>ORGANIZATION</span>

            <div className={styles.orgTitleRow}>
              {activeOrg?.logo64 && (
                <img src={activeOrg.logo64} alt="" className={styles.orgTitleLogo} />
              )}
              <h2 className={styles.sectionTitle}>
                Meet The {activeOrg?.name || 'Organization'} Officers
              </h2>
            </div>

            {currentTerm && (
              <span className={styles.officersTermBadge}>Term {currentTerm}</span>
            )}
            <p className={styles.sectionSubtitle}>
              The people leading {activeOrg?.name || 'this organization'} right now
            </p>
          </header>

          {/* Organization switcher */}
          {orgList.length > 1 && (
            <div className={styles.orgSwitcher} role="tablist" aria-label="Choose organization">
              {orgList.map((org) => (
                <button
                  key={org.id}
                  type="button"
                  role="tab"
                  aria-selected={org.id === activeOrg?.id}
                  className={`${styles.orgSwitcherTab} ${org.id === activeOrg?.id ? styles.orgSwitcherTabActive : ''}`}
                  onClick={() => setActiveOrgId(org.id)}
                >
                  {org.logo64
                    ? <img src={org.logo64} alt="" className={styles.orgSwitcherLogo} />
                    : <span className={styles.orgSwitcherFallback}>
                      {(org.name || 'O').charAt(0).toUpperCase()}
                    </span>}
                  <span className={styles.orgSwitcherName}>{org.name || 'Organization'}</span>
                </button>
              ))}
            </div>
          )}

          {orgRankedOfficers.length > 0 ? (
            <OfficerCarousel members={orgRankedOfficers} />
          ) : (
            <p className={styles.stateText}>
              No officers listed for {activeOrg?.name || 'this organization'} in the {currentTerm || 'current'} term yet.
            </p>
          )}
        </section>
      )}

      {/* ══════════════════════════════════════
          FOOTER
      ══════════════════════════════════════ */}
      {/* ══════════════════════════════════════
          SCROLL TO TOP
      ══════════════════════════════════════ */}
      {showScrollTop && (
        <button
          className={styles.scrollTopButton}
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Scroll to top"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15"></polyline>
          </svg>
        </button>
      )}

      {/* ══════════════════════════════════════
          FOOTER
      ══════════════════════════════════════ */}
      <footer className={`${styles.footer} ${isClassic ? styles.footerClassic : ''}`}>
        {isClassic && <div className={styles.footerTribalBorder} aria-hidden="true" />}
        <div className={styles.footerInner}>
          <div className={styles.footerLeft}>
            <div className={styles.footerBrandRow}>
              <img
                src="/images/logossg.png"
                alt="SSG Seal"
                className={styles.footerLogo}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
              <div>
                <span className={styles.footerBrand}>SUPREMO GOBYERNO</span>
                <p className={styles.footerSubBrand}>SUPREME STUDENT GOVERNMENT · CTU DAANBANTAYAN</p>
              </div>
            </div>
            <p className={styles.footerTagline}>Official Student Government Administrative & E-Commerce Platform</p>
            <p className={styles.footerMotto}><em>Ducere Non Ducere</em> — To Lead, Not to Be Led</p>
          </div>
          <div className={styles.footerRight}>
            <div className={styles.footerSocialLinks}>
              <a href="https://facebook.com/SSGCTUDB" className={styles.footerSocialLink} target="_blank" rel="noreferrer" aria-label="Official Facebook">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
              </a>
              <a href="https://www.instagram.com/ssgctudb/" className={styles.footerSocialLink} target="_blank" rel="noreferrer" aria-label="Official Instagram">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" /></svg>
              </a>
            </div>
            <p className={styles.footerCopyright}>
              © {new Date().getFullYear()} Supremo Student Government. All rights reserved.
            </p>
            <p className={styles.footerCampus}>Cebu Technological University — Daanbantayan Campus</p>
          </div>
        </div>
      </footer>

    </div>
  );
}

export default Homepage;

