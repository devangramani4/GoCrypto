let text = '';
module.exports = {
  __esModule: true,
  default: {
    setString: jest.fn((value) => {
      text = value;
    }),
    getString: jest.fn(async () => text),
  },
};
