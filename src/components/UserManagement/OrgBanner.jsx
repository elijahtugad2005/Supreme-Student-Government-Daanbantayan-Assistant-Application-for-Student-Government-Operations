import React, { memo } from "react";
import listStyles from "../memberlist.module.css";
import styles from "../WorkinProgress/organization.module.css";

// Title block shared by the SSG view and every other organization.
function OrgBanner({ name, logo, term, isArchived, description, onEdit }) {
  return (
    <div className={listStyles.ssgTitleWrapper}>
      {logo ? (
        <img src={logo} alt={`${name} logo`} className={styles.bannerLogo} decoding="async" />
      ) : (
        <div className={styles.bannerLogoFallback}>{(name || "O").charAt(0).toUpperCase()}</div>
      )}
      <h1 className={listStyles.ssgMainTitle}>{name}</h1>
      <p className={listStyles.ssgTerm}>
        Term: {term}
        {isArchived && <span className={styles.bannerBadge}>Archived term</span>}
      </p>
      {description && <p className={styles.bannerDesc}>{description}</p>}
      {onEdit && (
        <button type="button" className={styles.bannerEditBtn} onClick={onEdit}>
          🖼️ Edit Organization
        </button>
      )}
    </div>
  );
}

export default memo(OrgBanner);
