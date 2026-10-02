import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from "../firebase/firebaseConfig";
import { collection, onSnapshot } from "firebase/firestore";
import { useNavigate } from 'react-router-dom';
import styles from './Homepage.module.css'; // Import CSS module
import CalendarWidget from '../components/CalendarWidget/CalendarWidget';
import { useRef } from 'react';
import { useAuth } from '../components/AuthContext/AuthContext.jsx';
import useCurrentTerm from '../hooks/useCurrentTerm';
import { SSG_ID, FALLBACK_TERM, getSections } from '../components/orgUtils';

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

/* ───────────────────────────────────────────────
   OfficerCarousel — self-contained officer slider.
   Owns its slide index so several carousels can live
   on the page without fighting over shared state.
   ─────────────────────────────────────────────── */
function OfficerCarousel({ members }) {
  const [slide, setSlide] = useState(0);
  const [cardsPerView, setCardsPerView] = useState(3);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) setCardsPerView(1);
      else if (window.innerWidth < 1024) setCardsPerView(2);
      else setCardsPerView(3);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
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
      {totalSlides > 1 && (
        <>
          <button className={`${styles.carouselArrow} ${styles.carouselArrowLeft}`} onClick={prevSlide} aria-label="Previous slide">
            <ChevronLeftIcon />
          </button>
          <button className={`${styles.carouselArrow} ${styles.carouselArrowRight}`} onClick={nextSlide} aria-label="Next slide">
            <ChevronRightIcon />
          </button>
        </>
      )}

      <div className={styles.carouselContainer} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
        <div className={styles.carouselTrack}>
          <div
            className={styles.carouselSlides}
            style={{ transform: `translateX(-${slide * 100}%)`, transition: 'transform 0.5s ease-in-out' }}
          >
            {Array.from({ length: totalSlides }).map((_, slideIndex) => (
              <div key={slideIndex} className={styles.carouselSlide}>
                <div className={styles.officersGrid}>
                  {members
                    .slice(slideIndex * cardsPerView, (slideIndex + 1) * cardsPerView)
                    .map((officer) => (
                      <article key={officer.docId} className={styles.officerCard}>
                        <div className={styles.officerImageWrapper}>
                          <img
                            src={officer.image64 || OFFICER_FALLBACK_IMAGE}
                            alt={officer.name}
                            className={styles.officerImage}
                            onError={(e) => { e.target.src = OFFICER_FALLBACK_IMAGE; }}
                          />
                        </div>
                        <span className={styles.officerPosition}>{officer.position}</span>
                        <h3 className={styles.officerName}>{officer.name}</h3>
                        {officer.description && <p className={styles.officerDescription}>{officer.description}</p>}
                        {officer.facebookLink && (
                          <div className={styles.socialLinks}>
                            <a href={officer.facebookLink} className={styles.socialLink} target="_blank" rel="noreferrer" aria-label={`${officer.name} on Facebook`}><FacebookIcon /></a>
                          </div>
                        )}
                      </article>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {totalSlides > 1 && (
        <div className={styles.carouselDots}>
          {Array.from({ length: totalSlides }).map((_, index) => (
            <button
              key={index}
              className={`${styles.carouselDot} ${slide === index ? styles.carouselDotActive : ''}`}
              onClick={() => setSlide(index)}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Homepage({ toggleSidebar, sidebarOpen }) {
  const { userRole, currentUser } = useAuth();
  const { currentTerm } = useCurrentTerm();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
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

  // Refs for scrolling to sections
  const productsRef = useRef(null);
  const announcementsRef = useRef(null);
  const calendarRef = useRef(null);

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

  /* ── Hero Text Animation ── */
  useEffect(() => {
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
  }, [heroTextIndex]);

  /* ── Scroll-to-top visibility ── */
  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* ── News Slideshow: Auto-advance articles ── */
  useEffect(() => {
    if (newsArticles.length === 0) return;
    const interval = setInterval(() => {
      setNewsSlideIndex((prev) => (prev + 1) % newsArticles.length);
      setNewsImageIndex(0);
    }, 6000);
    return () => clearInterval(interval);
  }, [newsArticles.length]);

  /* ── News Slideshow: Auto-advance images within article ── */
  useEffect(() => {
    if (newsArticles.length === 0) return;
    const currentArticle = newsArticles[newsSlideIndex];
    if (!currentArticle?.images || currentArticle.images.length <= 1) return;
    const interval = setInterval(() => {
      setNewsImageIndex((prev) => (prev + 1) % currentArticle.images.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [newsSlideIndex, newsArticles]);

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

  const ShoppingBagIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 01-8 0" />
    </svg>
  );

  /* ─────────────────────────────────────────── */
  return (
    <div className={styles.pageWrapper}>

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
      <section className={styles.heroSection}>
        {/* Slideshow */}
        <div className={styles.slideContainer}>
          {['slide1', 'slide2', 'slide3', 'slide4', 'slide5', 'slide6'].map((s) => (
            <div key={s} className={`${styles.slide} ${styles[s]}`}></div>
          ))}
        </div>
        <div className={styles.heroOverlay}></div>
        {/* Diagonal texture */}
        <div className={styles.diagonalTexture}></div>

        <div className={styles.heroContentWrapper}>
          <div className={styles.heroContent}>
            {/* Eyebrow label */}
            <span className={styles.heroEyebrow}>Official Student Government Platform</span>
            <h1 className={`${styles.heroTitle} ${isHeroFading ? styles.heroTitleFadeOut : styles.heroTitleFadeIn}`}>
              {heroTexts[heroTextIndex].text.split('\n').map((line, i) => (
                <React.Fragment key={i}>
                  {line}
                  {i < heroTexts[heroTextIndex].text.split('\n').length - 1 && <br />}
                </React.Fragment>
              ))}
            </h1>
            <div className={styles.heroRule}></div>
            <p className={styles.heroDescription}>
              <em>Centralizing Student Government for a Connected Future.</em>{' '}
              Track, engage, and plan university events with unprecedented efficiency.
            </p>
            <button className={styles.exploreButton} onClick={() => scrollToSection(productsRef)}>EXPLORE SERVICES</button>
          </div>

          {/* Quick Access */}
          <div className={styles.quickAccessSection}>
            <p className={styles.quickAccessEyebrow}>QUICK ACCESS</p>
            <div className={styles.quickAccessGrid}>
              {(() => {
                const getRoleQuickAccessItems = () => {
                  switch (userRole) {
                    case 'secretary':
                      return [
                        { icon: '💰', label: 'Finances', action: () => navigate('/finance') },
                        { icon: '📁', label: 'Documents', action: () => navigate('/documents') },
                        { icon: '📢', label: 'Announcements', action: () => navigate('/announcement') },
                      ];
                    case 'representative':
                      return [
                        { icon: '📁', label: 'Documents', action: () => navigate('/documents') },
                        { icon: '📦', label: 'Inventory', action: () => navigate('/inventory') },
                        { icon: '📢', label: 'Announcements', action: () => navigate('/announcement') },
                      ];
                    case 'finance_secretary':
                      return [
                        { icon: '🛍️', label: 'Commerce Hub', action: () => navigate('/commerce') },
                        { icon: '📁', label: 'Documents', action: () => navigate('/documents') },
                        { icon: '💰', label: 'Finances', action: () => navigate('/finance') },
                      ];
                    case 'senator':
                      return [
                        { icon: '📦', label: 'Inventory', action: () => navigate('/inventory') },
                        { icon: '📁', label: 'Documents', action: () => navigate('/documents') },
                        { icon: '📅', label: 'Events & Announcements', action: () => scrollToSection(announcementsRef) },
                      ];
                    case 'admin':
                      return [
                        { icon: '⚙️', label: 'Admin Dashboard', action: () => navigate('/admin') },
                        { icon: '💰', label: 'Finances', action: () => navigate('/finance') },
                        { icon: '📁', label: 'User Management', action: () => navigate('/admin/users') },
                      ];
                    default:
                      // member, guest, or unauthenticated default
                      return [
                        { icon: '📦', label: 'Track My Order', action: () => navigate('/track-order') },
                        { icon: '🛍️', label: 'Product Catalogue', action: () => scrollToSection(productsRef) },
                        { icon: '📅', label: 'Events & Announcements', action: () => scrollToSection(announcementsRef) },
                      ];
                  }
                };

                return getRoleQuickAccessItems().map(({ icon, label, action }) => (
                  <div
                    key={label}
                    className={`${styles.quickAccessCard} ${action ? styles.quickAccessCardClickable : ''}`}
                    onClick={action}
                    role={action ? 'button' : 'div'}
                    tabIndex={action ? 0 : undefined}
                  >
                    <span className={styles.quickAccessIcon}>{icon}</span>
                    <span className={styles.quickAccessLabel}>{label}</span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      </section>

      <hr className={styles.sectionRule} />

      {/* ══════════════════════════════════════
          PRODUCTS
      ══════════════════════════════════════ */}
      <section ref={productsRef} className={styles.productsSection}>
        <header className={styles.sectionHeader}>
          <span className={styles.sectionEyebrow}>CATALOGUE</span>
          <h2 className={styles.sectionTitle}>Our Products</h2>
          <p className={styles.sectionSubtitle}>
            Official lanyards &amp; uniforms for the student body
          </p>
        </header>

        {loading ? (
          <div className={styles.skeletonGrid}>
            {[1, 2, 3].map((n) => (
              <div key={n} className={styles.skeletonCard}>
                <div className={styles.skeletonImage} />
                <div className={styles.skeletonBody}>
                  <div className={styles.skeletonLine} style={{ width: '40%' }} />
                  <div className={styles.skeletonLine} style={{ width: '80%' }} />
                  <div className={styles.skeletonLine} style={{ width: '60%' }} />
                  <div className={styles.skeletonLine} style={{ width: '100%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <p className={styles.stateText}>No products available at the moment. Check back soon!</p>
        ) : (
          <div className={styles.productsGrid}>
            {products.map((product) => (
              <article key={product.productId} className={styles.productCard}>
                <div className={styles.productImageWrapper}>
                  <img
                    src={product.imageUrl || 'https://images.unsplash.com/photo-1434494878577-86c23bcb06b9?w=600&h=600&fit=crop'}
                    alt={product.productName}
                    className={styles.productImage}
                    onError={(e) => { e.target.src = 'https://images.unsplash.com/photo-1434494878577-86c23bcb06b9?w=600&h=600&fit=crop'; }}
                  />
                  {product.stockAvailable <= 10 && product.stockAvailable > 0 && (
                    <span className={styles.badgeLow}>Low Stock</span>
                  )}
                  {product.stockAvailable === 0 && (
                    <span className={styles.badgeOut}>Out of Stock</span>
                  )}
                </div>

                <div className={styles.productInfo}>
                  <span className={styles.productCategoryLabel}>MERCHANDISE</span>
                  <h3 className={styles.productName}>{product.productName}</h3>
                  {product.description && (
                    <p className={styles.productDescription}>{product.description}</p>
                  )}

                  <div className={styles.productMeta}>
                    <span className={styles.price}>₱{product.price?.toFixed(2)}</span>
                    <span className={styles.stock}>{product.stockAvailable || 0} in stock</span>
                  </div>

                  {product.sizeOptions?.length > 0 && (
                    <div className={styles.tagRow}>
                      <span className={styles.tagRowLabel}>Sizes</span>
                      {product.sizeOptions.map((s, i) => <span key={i} className={styles.tag}>{s}</span>)}
                    </div>
                  )}
                  {product.colorVariations?.length > 0 && (
                    <div className={styles.tagRow}>
                      <span className={styles.tagRowLabel}>Colors</span>
                      {product.colorVariations.map((c, i) => <span key={i} className={styles.tag}>{c}</span>)}
                    </div>
                  )}

                  <button
                    onClick={() => handleOrderNow(product)}
                    disabled={product.stockAvailable === 0}
                    className={`${styles.orderButton} ${product.stockAvailable === 0 ? styles.orderButtonDisabled : ''}`}
                  >
                    <ShoppingBagIcon />
                    <span>{product.stockAvailable === 0 ? 'Out of Stock' : 'Order Now'}</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <hr className={styles.sectionRule} />

      {/* ══════════════════════════════════════
          WHAT'S NEW — News Slideshow
      ══════════════════════════════════════ */}
      {newsArticles.length > 0 && (
        <section className={styles.whatsNewSection}>
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

            {/* Remaining items — list style */}
            <div className={styles.announcementList}>
              {announcements.slice(1).map((ann) => (
                <article
                  key={ann.id}
                  className={styles.announcementListItem}
                  onClick={() => setExpandedId(expandedID === ann.id ? null : ann.id)}
                >
                  <div className={styles.announcementListLeft}>
                    {ann.imageBase64 && (
                      <div className={styles.announcementListThumb}>
                        <img src={ann.imageBase64} alt={ann.title}
                          onError={(e) => { e.target.src = '/AnnouncementPic/default.jpg'; }} />
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
                  <div className={styles.announcementListToggle}>
                    {expandedID === ann.id ? '−' : '+'}
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
      </section>

      <hr className={styles.sectionRule} />

      {/* ══════════════════════════════════════
          CALENDAR
      ══════════════════════════════════════ */}
      <section ref={calendarRef} className={styles.calendarSection}>
        <header className={styles.sectionHeader}>
          <span className={styles.sectionEyebrow}>SCHEDULE</span>
          <h2 className={styles.sectionTitle}>Academic Calendar</h2>
        </header>
        <div className={styles.calendarWrapper}>
          <CalendarWidget />
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
      <footer className={styles.footer}>
        <hr className={styles.footerRule} />
        <div className={styles.footerInner}>
          <div className={styles.footerLeft}>
            <span className={styles.footerBrand}>SUPREMO GOBYERNO</span>
            <p className={styles.footerTagline}>Official Student Government E-Commerce Platform</p>
          </div>
          <div className={styles.footerRight}>
            <div className={styles.footerSocialLinks}>
              <a href="https://facebook.com" className={styles.footerSocialLink} target="_blank" rel="noreferrer" aria-label="Facebook">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
              </a>
              <a href="https://twitter.com" className={styles.footerSocialLink} target="_blank" rel="noreferrer" aria-label="Twitter">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z" /></svg>
              </a>
              <a href="https://instagram.com" className={styles.footerSocialLink} target="_blank" rel="noreferrer" aria-label="Instagram">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" /></svg>
              </a>
            </div>
            <p className={styles.footerCopyright}>
              © 2025 Supremo Gobyerno. All rights reserved.
            </p>
          </div>
        </div>
      </footer>

    </div>
  );
}

export default Homepage;

