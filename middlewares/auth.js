exports.requireAuth = (req, res, next) => {
  if (req.session.isAuthenticated) {
    next();
    return;
  }

  res.redirect('/admin/login');
};
