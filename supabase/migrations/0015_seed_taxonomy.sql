-- 0015_seed_taxonomy.sql
-- Re-seed categories + subcategories to mirror the Expo frontend taxonomy
-- (learnsum-mvp-expo-app · app/onboarding/StudentCatSel.tsx). The FRONTEND is
-- the source of truth: every slug here equals the frontend's subId, so
-- POST /api/onboarding maps each subject by slug with nothing dropped into
-- `skipped.unknown_subjects`.
--
-- Auto-generated from the frontend source: 5 categories, 91 subjects.
-- The frontend lists "english" under BOTH Academics and Languages; subcategory
-- slugs are globally UNIQUE, so "english" is seeded once (under Academics) and
-- the Languages "english" pick maps to that same row.
--
-- name_zh is a PLACEHOLDER (= name_en) until the i18n content pass translates
-- subject/category names (deferred per CLAUDE.md).
--
-- WARNING: this DELETEs the existing taxonomy and re-inserts it with fresh
-- UUIDs. Existing tutor subject links + student/child interests (FK ->
-- subcategories) are cleared by ON DELETE CASCADE. Fine for dev/MVP — re-run
-- onboarding to repopulate.

BEGIN;

-- Cascades to subcategories -> tutor_subcategories, user_category_interests,
-- child_category_interests.
DELETE FROM categories;

INSERT INTO categories (slug, name_en, name_zh) VALUES
  ('sports', 'Sports', 'Sports'),
  ('academics', 'Academics', 'Academics'),
  ('culinary', 'Culinary', 'Culinary'),
  ('arts', 'Arts & Crafts', 'Arts & Crafts'),
  ('languages', 'Languages', 'Languages');

INSERT INTO subcategories (category_id, slug, name_en, name_zh)
SELECT c.id, v.slug, v.name_en, v.name_en
FROM (VALUES
  ('sports', 'basketball', 'Basketball'),
  ('sports', 'soccer', 'Soccer'),
  ('sports', 'volleyball', 'Volleyball'),
  ('sports', 'badminton', 'Badminton'),
  ('sports', 'swimming', 'Swimming'),
  ('sports', 'tennis', 'Tennis'),
  ('sports', 'table-tennis', 'Table Tennis'),
  ('sports', 'running', 'Running'),
  ('sports', 'gymnastics', 'Gymnastics'),
  ('sports', 'rugby', 'Rugby'),
  ('sports', 'boxing', 'Boxing'),
  ('sports', 'yoga', 'Yoga'),
  ('sports', 'cycling', 'Cycling'),
  ('sports', 'golf', 'Golf'),
  ('sports', 'karate', 'Karate'),
  ('sports', 'skating', 'Skating'),
  ('sports', 'climbing', 'Climbing'),
  ('sports', 'dance', 'Dance'),
  ('sports', 'cricket', 'Cricket'),
  ('sports', 'squash', 'Squash'),
  ('academics', 'mathematics', 'Mathematics'),
  ('academics', 'english', 'English'),
  ('academics', 'chinese', 'Chinese'),
  ('academics', 'science', 'Science'),
  ('academics', 'physics', 'Physics'),
  ('academics', 'chemistry', 'Chemistry'),
  ('academics', 'biology', 'Biology'),
  ('academics', 'history', 'History'),
  ('academics', 'geography', 'Geography'),
  ('academics', 'economics', 'Economics'),
  ('academics', 'computer-science', 'Computer Science'),
  ('academics', 'accounting', 'Accounting'),
  ('academics', 'psychology', 'Psychology'),
  ('academics', 'business-studies', 'Business Studies'),
  ('academics', 'literature', 'Literature'),
  ('academics', 'statistics', 'Statistics'),
  ('academics', 'coding', 'Coding'),
  ('academics', 'philosophy', 'Philosophy'),
  ('culinary', 'baking', 'Baking'),
  ('culinary', 'chinese-cuisine', 'Chinese Cuisine'),
  ('culinary', 'western-cuisine', 'Western Cuisine'),
  ('culinary', 'japanese-cuisine', 'Japanese Cuisine'),
  ('culinary', 'desserts', 'Desserts'),
  ('culinary', 'healthy-cooking', 'Healthy Cooking'),
  ('culinary', 'kids-cooking', 'Kids Cooking'),
  ('culinary', 'vegetarian', 'Vegetarian'),
  ('culinary', 'korean-cuisine', 'Korean Cuisine'),
  ('culinary', 'thai-cuisine', 'Thai Cuisine'),
  ('culinary', 'italian-cuisine', 'Italian Cuisine'),
  ('culinary', 'cake-decorating', 'Cake Decorating'),
  ('culinary', 'sushi-making', 'Sushi Making'),
  ('culinary', 'coffee-barista', 'Coffee/Barista'),
  ('culinary', 'vegan-cooking', 'Vegan Cooking'),
  ('culinary', 'bbq', 'BBQ'),
  ('culinary', 'pastry', 'Pastry'),
  ('culinary', 'dim-sum', 'Dim Sum'),
  ('arts', 'drawing', 'Drawing'),
  ('arts', 'painting', 'Painting'),
  ('arts', 'pottery', 'Pottery'),
  ('arts', 'origami', 'Origami'),
  ('arts', 'knitting', 'Knitting'),
  ('arts', 'calligraphy', 'Calligraphy'),
  ('arts', 'photography', 'Photography'),
  ('arts', 'digital-art', 'Digital Art'),
  ('arts', 'watercolor', 'Watercolor'),
  ('arts', 'sketching', 'Sketching'),
  ('arts', 'animation', 'Animation'),
  ('arts', 'graphic-design', 'Graphic Design'),
  ('arts', 'sewing', 'Sewing'),
  ('arts', 'crochet', 'Crochet'),
  ('arts', 'jewelry-making', 'Jewelry Making'),
  ('arts', 'sculpture', 'Sculpture'),
  ('arts', 'comic-art', 'Comic Art'),
  ('arts', 'embroidery', 'Embroidery'),
  ('languages', 'mandarin', 'Mandarin'),
  ('languages', 'cantonese', 'Cantonese'),
  ('languages', 'japanese', 'Japanese'),
  ('languages', 'korean', 'Korean'),
  ('languages', 'french', 'French'),
  ('languages', 'spanish', 'Spanish'),
  ('languages', 'german', 'German'),
  ('languages', 'italian', 'Italian'),
  ('languages', 'portuguese', 'Portuguese'),
  ('languages', 'thai', 'Thai'),
  ('languages', 'vietnamese', 'Vietnamese'),
  ('languages', 'arabic', 'Arabic'),
  ('languages', 'russian', 'Russian'),
  ('languages', 'hindi', 'Hindi'),
  ('languages', 'sign-language', 'Sign Language'),
  ('languages', 'dutch', 'Dutch'),
  ('languages', 'tagalog', 'Tagalog')
) AS v(cat_slug, slug, name_en)
JOIN categories c ON c.slug = v.cat_slug;

COMMIT;
