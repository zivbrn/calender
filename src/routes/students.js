const express = require('express');
const { requireAuth } = require('../auth/middleware');
const { getStudentContacts, getStudentMoeds } = require('../db/users');

const router = express.Router();

router.get('/students', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const moeds = getStudentMoeds(userId);

  const selectedMoed = req.query.moed || (moeds.length > 0 ? moeds[0].moed : null);
  const contactsMap = selectedMoed ? getStudentContacts(userId, selectedMoed) : {};

  const students = Object.entries(contactsMap)
    .map(([name, phone]) => ({ name, phone }))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));

  res.render('students', { students, moeds, selectedMoed });
});

module.exports = router;
