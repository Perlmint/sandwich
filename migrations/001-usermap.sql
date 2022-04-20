--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

CREATE TABLE UserMap (
  protocol VARCHAR(8) NOT NULL,
  remote_id VARCHAR(64) NOT NULL,
  internal_id VARCHAR(32) NOT NULL,
  INDEX remote_pair (protocol, remote_id),
  INDEX internal_pair (protocol, internal_id),
  INDEX internal_ids (internal_id)
);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

DROP TABLE UserMap;