import build from "../src/app";
const app = build();

test('requests the "/" route', async (done) => {
  const response = await app.inject({
    method: "GET",
    url: "/",
  });
  expect(response.statusCode).toBe(200);

  done();
});

afterAll(() => {
  app.close();
});
